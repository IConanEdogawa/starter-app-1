using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StarterApp.Api.Contracts.Notifications;
using StarterApp.Api.Data;
using StarterApp.Api.Models;

namespace StarterApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Worker,VIP,Developer")]
public sealed class NotificationsController(AppDbContext db) : ControllerBase
{
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

        var targetRole = string.IsNullOrWhiteSpace(request.TargetRole)
            ? "Worker"
            : request.TargetRole.Trim();

        if (!new[] { "Worker", "VIP", "Developer" }.Contains(targetRole, StringComparer.OrdinalIgnoreCase))
        {
            return BadRequest("TargetRole must be Worker, VIP, or Developer.");
        }

        var entity = new NotificationEvent
        {
            CreatedByUserId = creatorId,
            CreatedByUserName = creatorName,
            TargetRole = targetRole,
            Title = request.Title.Trim(),
            Message = request.Message.Trim(),
            RelatedType = request.RelatedType?.Trim() ?? string.Empty,
            RelatedId = request.RelatedId?.Trim() ?? string.Empty,
            CreatedAt = DateTime.UtcNow
        };

        db.Notifications.Add(entity);
        await db.SaveChangesAsync();

        return Ok(ToResponse(entity));
    }

    [HttpGet("inbox")]
    public async Task<ActionResult<IReadOnlyList<NotificationResponse>>> Inbox([FromQuery] bool unackedOnly = true, [FromQuery] int take = 50)
    {
        var role = User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;
        var safeTake = Math.Clamp(take, 1, 200);

        var query = db.Notifications.AsQueryable();
        if (!string.IsNullOrWhiteSpace(role))
        {
            query = query.Where(x => x.TargetRole == role || x.TargetRole == "Worker");
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
        }

        return Ok(ToResponse(entity));
    }

    private static NotificationResponse ToResponse(NotificationEvent x) => new(
        x.Id,
        x.CreatedByUserName,
        x.TargetRole,
        x.Title,
        x.Message,
        x.RelatedType,
        x.RelatedId,
        x.IsAcknowledged,
        x.AcknowledgedAt,
        x.AcknowledgedByUserName,
        x.CreatedAt
    );
}
