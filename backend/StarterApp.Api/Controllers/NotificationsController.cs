using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using StarterApp.Api.Contracts.Notifications;
using StarterApp.Api.Data;
using StarterApp.Api.Hubs;
using StarterApp.Api.Models;

namespace StarterApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Worker,VIP,Developer")]
public sealed class NotificationsController(AppDbContext db, IHubContext<NotificationsHub> hubContext) : ControllerBase
{
    private const string TargetedTransactionType = "transaction_targeted";

    [HttpPost]
    [Authorize(Roles = "VIP,Developer")]
    public async Task<ActionResult<NotificationResponse>> Create(CreateNotificationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.Message))
        {
            return BadRequest("Title and Message are required.");
        }

        var creatorIdRaw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        var creatorName = User.Identity?.Name ?? "unknown";
        if (!Guid.TryParse(creatorIdRaw, out var creatorId))
        {
            return Unauthorized("Invalid user id in token.");
        }

        var targetRole = NormalizeRoleOrEmpty(request.TargetRole);
        if (string.IsNullOrEmpty(targetRole))
        {
            return BadRequest("TargetRole must be Worker, VIP, or Developer.");
        }

        Guid? targetUserId = null;
        if (!string.IsNullOrWhiteSpace(request.TargetUserId))
        {
            if (!Guid.TryParse(request.TargetUserId, out var parsedTargetUserId))
            {
                return BadRequest("TargetUserId must be a valid guid.");
            }

            var workerExists = await db.Users.AnyAsync(x => x.Id == parsedTargetUserId && x.Role == UserRole.Worker);
            if (!workerExists)
            {
                return BadRequest("Target user must be an existing Worker.");
            }

            targetUserId = parsedTargetUserId;
            targetRole = "Worker";
        }

        var relatedType = request.RelatedType?.Trim() ?? string.Empty;
        var relatedId = request.RelatedId?.Trim() ?? string.Empty;
        var isLatestTransaction = request.IsLatestTransaction ?? false;

        if (isLatestTransaction)
        {
            if (request.TransactionCreatedAtUtc is null)
            {
                return BadRequest("TransactionCreatedAtUtc is required for latest transaction notifications.");
            }

            var age = DateTime.UtcNow - request.TransactionCreatedAtUtc.Value.ToUniversalTime();
            if (age > TimeSpan.FromHours(1))
            {
                return BadRequest("Latest transaction is older than 1 hour.");
            }

            if (string.IsNullOrWhiteSpace(relatedId))
            {
                return BadRequest("RelatedId is required for latest transaction notifications.");
            }

            if (!targetUserId.HasValue)
            {
                return BadRequest("Latest transaction notifications must target a specific worker.");
            }
        }

        if (string.Equals(relatedType, "transaction", StringComparison.OrdinalIgnoreCase) && !targetUserId.HasValue)
        {
            return BadRequest("Transaction notifications must target a specific worker.");
        }

        if (targetUserId.HasValue)
        {
            relatedType = TargetedTransactionType;
            relatedId = BuildTargetedRelatedId(relatedId, targetUserId.Value);
        }

        var entity = new NotificationEvent
        {
            CreatedByUserId = creatorId,
            CreatedByUserName = creatorName,
            TargetRole = targetRole,
            Title = request.Title.Trim(),
            Message = request.Message.Trim(),
            RelatedType = relatedType,
            RelatedId = relatedId,
            CreatedAt = DateTime.UtcNow
        };

        if (targetUserId.HasValue && !string.IsNullOrWhiteSpace(relatedId))
        {
            var hasActiveSameTarget = await db.Notifications.AnyAsync(x =>
                x.RelatedType == TargetedTransactionType
                && x.RelatedId == relatedId
                && !x.IsAcknowledged);

            if (hasActiveSameTarget)
            {
                return Conflict("This worker already has an active notification for this transaction.");
            }

            if (isLatestTransaction)
            {
                var txnPrefix = ExtractTransactionIdPrefix(relatedId);
                var hasAnyForLatestTxn = await db.Notifications.AnyAsync(x =>
                    x.RelatedType == TargetedTransactionType
                    && x.RelatedId.StartsWith(txnPrefix + "|"));

                if (hasAnyForLatestTxn)
                {
                    return Conflict("Latest transaction has already been notified.");
                }
            }
        }

        db.Notifications.Add(entity);
        await db.SaveChangesAsync();

        var response = ToResponse(entity);
        if (targetUserId.HasValue)
        {
            await hubContext.Clients.Group($"user:{targetUserId.Value}")
                .SendAsync("notification_created", response);
        }
        else
        {
            await hubContext.Clients.Group($"role:{targetRole.ToLowerInvariant()}")
                .SendAsync("notification_created", response);
        }

        return Ok(response);
    }

    [HttpGet("inbox")]
    public async Task<ActionResult<IReadOnlyList<NotificationResponse>>> Inbox([FromQuery] bool unackedOnly = true, [FromQuery] int take = 50)
    {
        var role = User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;
        var userIdRaw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        Guid? currentUserId = Guid.TryParse(userIdRaw, out var parsedCurrentUserId) ? parsedCurrentUserId : null;
        var safeTake = Math.Clamp(take, 1, 200);

        var query = db.Notifications.AsQueryable();
        if (!string.IsNullOrWhiteSpace(role))
        {
            var normalizedRole = role.Trim();
            query = query.Where(x =>
                (x.RelatedType == TargetedTransactionType && currentUserId.HasValue && x.RelatedId.EndsWith("|" + currentUserId.Value))
                ||
                (x.RelatedType != TargetedTransactionType && (x.TargetRole == normalizedRole || x.TargetRole == "Worker"))
            );
        }

        if (unackedOnly)
        {
            query = query.Where(x => !x.IsAcknowledged);
        }

        var items = await query
            .OrderByDescending(x => x.CreatedAt)
            .Take(safeTake)
            .Select(x => ToResponse(x))
            .ToListAsync();

        return Ok(items);
    }

    [HttpPost("{id:guid}/ack")]
    public async Task<ActionResult<NotificationResponse>> Acknowledge(Guid id)
    {
        var entity = await db.Notifications.FirstOrDefaultAsync(x => x.Id == id);
        if (entity is null)
        {
            return NotFound("Notification not found.");
        }

        if (!entity.IsAcknowledged)
        {
            var userIdRaw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
            Guid? userId = Guid.TryParse(userIdRaw, out var parsed) ? parsed : null;
            entity.IsAcknowledged = true;
            entity.AcknowledgedAt = DateTime.UtcNow;
            entity.AcknowledgedByUserId = userId;
            entity.AcknowledgedByUserName = User.Identity?.Name ?? "unknown";
            await db.SaveChangesAsync();

            var updated = ToResponse(entity);
            if (TryExtractTargetUserId(entity.RelatedType, entity.RelatedId, out var ackTargetUserId))
            {
                await hubContext.Clients.Group($"user:{ackTargetUserId}")
                    .SendAsync("notification_acknowledged", updated);
            }
            else
            {
                await hubContext.Clients.Group($"role:{entity.TargetRole.ToLowerInvariant()}")
                    .SendAsync("notification_acknowledged", updated);
            }
            await hubContext.Clients.Group("role:vip")
                .SendAsync("notification_acknowledged", updated);
            await hubContext.Clients.Group("role:developer")
                .SendAsync("notification_acknowledged", updated);
        }

        return Ok(ToResponse(entity));
    }

    private static NotificationResponse ToResponse(NotificationEvent x) => new(
        x.Id,
        x.CreatedByUserName,
        x.TargetRole,
        TryExtractTargetUserId(x.RelatedType, x.RelatedId, out var targetUserId) ? targetUserId.ToString() : null,
        x.Title,
        x.Message,
        x.RelatedType,
        x.RelatedId,
        x.IsAcknowledged,
        x.AcknowledgedAt,
        x.AcknowledgedByUserName,
        x.CreatedAt
    );

    private static string BuildTargetedRelatedId(string relatedId, Guid targetUserId)
    {
        var txnId = string.IsNullOrWhiteSpace(relatedId) ? string.Empty : relatedId.Trim();
        return txnId + "|" + targetUserId;
    }

    private static bool TryExtractTargetUserId(string relatedType, string relatedId, out Guid targetUserId)
    {
        targetUserId = Guid.Empty;
        if (!string.Equals(relatedType, TargetedTransactionType, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var pipeIndex = relatedId.LastIndexOf('|');
        if (pipeIndex < 0 || pipeIndex == relatedId.Length - 1)
        {
            return false;
        }

        var candidate = relatedId[(pipeIndex + 1)..];
        return Guid.TryParse(candidate, out targetUserId);
    }

    private static string ExtractTransactionIdPrefix(string relatedId)
    {
        var pipeIndex = relatedId.LastIndexOf('|');
        if (pipeIndex <= 0)
        {
            return relatedId.Trim();
        }

        return relatedId[..pipeIndex].Trim();
    }

    private static string NormalizeRoleOrEmpty(string? role)
    {
        var r = (role ?? "Worker").Trim().ToLowerInvariant();
        return r switch
        {
            "worker" => "Worker",
            "vip" => "VIP",
            "developer" => "Developer",
            _ => string.Empty
        };
    }
}
