using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StarterApp.Api.Contracts.Invites;
using StarterApp.Api.Data;
using StarterApp.Api.Models;

namespace StarterApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class InvitesController(AppDbContext db, IConfiguration configuration) : ControllerBase
{
    [HttpPost("worker")]
    [Authorize(Roles = "VIP,Developer")]
    public async Task<ActionResult<WorkerInviteResponse>> CreateWorkerInvite(CreateWorkerInviteRequest request)
    {
        var userIdRaw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        var userName = User.Identity?.Name ?? "unknown";
        if (!Guid.TryParse(userIdRaw, out var userId))
        {
            return Unauthorized("Invalid user id in token.");
        }

        var hours = Math.Clamp(request.ExpiresInHours ?? 24, 1, 168);
        var token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N")[..8];

        var invite = new WorkerInvite
        {
            Token = token,
            CreatedByUserId = userId,
            CreatedByUserName = userName,
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddHours(hours)
        };

        db.WorkerInvites.Add(invite);
        await db.SaveChangesAsync();

        var baseUrl = ResolveRegistrationBaseUrl();

        var sep = baseUrl.Contains('?') ? '&' : '?';
        var link = $"{baseUrl}{sep}invite={Uri.EscapeDataString(token)}";

        return Ok(new WorkerInviteResponse(invite.Token, link, invite.ExpiresAt, invite.CreatedAt, invite.IsUsed));
    }

    [HttpGet("worker/validate")]
    [AllowAnonymous]
    public async Task<ActionResult<object>> ValidateWorkerInvite([FromQuery] string token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return Ok(new { valid = false, reason = "Token is required." });
        }

        var invite = await db.WorkerInvites.FirstOrDefaultAsync(x => x.Token == token.Trim());
        if (invite is null)
        {
            return Ok(new { valid = false, reason = "Invalid token." });
        }

        if (invite.IsUsed)
        {
            return Ok(new { valid = false, reason = "Token already used.", expiresAtUtc = invite.ExpiresAt });
        }

        if (invite.ExpiresAt <= DateTime.UtcNow)
        {
            return Ok(new { valid = false, reason = "Token expired.", expiresAtUtc = invite.ExpiresAt });
        }

        return Ok(new { valid = true, expiresAtUtc = invite.ExpiresAt });
    }

    private string ResolveRegistrationBaseUrl()
    {
        var configured = configuration["Frontend:RegistrationBaseUrl"]?.Trim();
        if (!string.IsNullOrWhiteSpace(configured)) return configured;

        var origin = Request.Headers.Origin.ToString().Trim();
        if (Uri.TryCreate(origin, UriKind.Absolute, out var originUri))
        {
            return new Uri(originUri, "index.html").ToString();
        }

        return "http://localhost:5500/index.html";
    }
}
