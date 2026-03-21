using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StarterApp.Api.Contracts.Worker;
using StarterApp.Api.Data;
using StarterApp.Api.Models;

namespace StarterApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Worker,VIP,Developer")]
public sealed class WorkerCashActionsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<WorkerCashActionResponse>>> GetLatest([FromQuery] int take = 50)
    {
        var safeTake = Math.Clamp(take, 1, 200);
        var list = await db.WorkerCashActions
            .OrderByDescending(x => x.ActionAt)
            .Take(safeTake)
            .Select(x => new WorkerCashActionResponse(
                x.Id,
                x.UserName,
                x.ActionType,
                x.Amount,
                x.Currency,
                x.Note,
                x.ActionAt,
                x.CreatedAt
            ))
            .ToListAsync();

        return Ok(list);
    }

    [HttpPost]
    public async Task<ActionResult<WorkerCashActionResponse>> Create(CreateWorkerCashActionRequest request)
    {
        var actionType = request.ActionType.Trim().ToLowerInvariant();
        if (actionType is not ("give" or "take"))
        {
            return BadRequest("ActionType must be 'give' or 'take'.");
        }

        if (request.Amount <= 0)
        {
            return BadRequest("Amount must be greater than 0.");
        }

        var currency = request.Currency.Trim().ToLowerInvariant();
        if (currency is not ("won" or "usd"))
        {
            return BadRequest("Currency must be 'won' or 'usd'.");
        }

        var userIdRaw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        var userName = User.Identity?.Name ?? "unknown";
        if (!Guid.TryParse(userIdRaw, out var userId))
        {
            return Unauthorized("Invalid user id in token.");
        }

        var entity = new WorkerCashAction
        {
            UserId = userId,
            UserName = userName,
            ActionType = actionType,
            Amount = request.Amount,
            Currency = currency,
            Note = request.Note?.Trim() ?? string.Empty,
            ActionAt = request.ActionAt?.ToUniversalTime() ?? DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };

        db.WorkerCashActions.Add(entity);
        await db.SaveChangesAsync();

        var response = new WorkerCashActionResponse(
            entity.Id,
            entity.UserName,
            entity.ActionType,
            entity.Amount,
            entity.Currency,
            entity.Note,
            entity.ActionAt,
            entity.CreatedAt
        );

        return Ok(response);
    }
}
