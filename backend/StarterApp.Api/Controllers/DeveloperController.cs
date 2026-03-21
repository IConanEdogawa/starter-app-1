using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StarterApp.Api.Data;
using StarterApp.Api.Models;

namespace StarterApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Developer")]
public sealed class DeveloperController(AppDbContext db) : ControllerBase
{
    [HttpGet("overview")]
    public async Task<ActionResult<object>> GetOverview()
    {
        var canConnect = await db.Database.CanConnectAsync();

        var usersTotal = await db.Users.CountAsync();
        var workers = await db.Users.CountAsync(x => x.Role == UserRole.Worker);
        var vips = await db.Users.CountAsync(x => x.Role == UserRole.VIP);
        var developers = await db.Users.CountAsync(x => x.Role == UserRole.Developer);

        var invitesTotal = await db.WorkerInvites.CountAsync();
        var invitesUsed = await db.WorkerInvites.CountAsync(x => x.UsedAt != null);
        var invitesExpired = await db.WorkerInvites.CountAsync(x => x.ExpiresAt <= DateTime.UtcNow && x.UsedAt == null);

        var notificationsTotal = await db.Notifications.CountAsync();
        var notificationsUnacked = await db.Notifications.CountAsync(x => !x.IsAcknowledged);

        var workerActionsTotal = await db.WorkerCashActions.CountAsync();

        return Ok(new
        {
            serverTimeUtc = DateTime.UtcNow,
            dbConnected = canConnect,
            users = new { total = usersTotal, workers, vips, developers },
            invites = new { total = invitesTotal, used = invitesUsed, expired = invitesExpired },
            notifications = new { total = notificationsTotal, unacked = notificationsUnacked },
            workerCashActions = new { total = workerActionsTotal }
        });
    }

    [HttpPost("invites/cleanup")]
    public async Task<ActionResult<object>> CleanupExpiredInvites()
    {
        var now = DateTime.UtcNow;
        var toDelete = await db.WorkerInvites
            .Where(x => x.ExpiresAt <= now && x.UsedAt == null)
            .ToListAsync();

        var deleted = toDelete.Count;
        if (deleted > 0)
        {
            db.WorkerInvites.RemoveRange(toDelete);
            await db.SaveChangesAsync();
        }

        return Ok(new { deleted, atUtc = now });
    }
}
