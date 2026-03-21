using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StarterApp.Api.Contracts.Auth;
using StarterApp.Api.Data;
using StarterApp.Api.Models;
using StarterApp.Api.Services;

namespace StarterApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class AuthController(AppDbContext db, IJwtTokenService jwtTokenService) : ControllerBase
{
    [HttpPost("register-worker")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> RegisterWorker(RegisterWorkerRequest request)
    {
        var userName = request.UserName.Trim();
        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest("Username and password are required.");
        }

        if (!PasswordPolicy.TryValidate(request.Password, out var passwordError))
        {
            return BadRequest($"{passwordError} Hint: {PasswordPolicy.Hint}");
        }

        if (await db.Users.AnyAsync(x => x.UserName == userName))
        {
            return Conflict("Username already exists.");
        }

        var inviteToken = request.InviteToken?.Trim();
        if (string.IsNullOrWhiteSpace(inviteToken))
        {
            return BadRequest("Invite token is required.");
        }

        var invite = await db.WorkerInvites.FirstOrDefaultAsync(x => x.Token == inviteToken);
        if (invite is null)
        {
            return BadRequest("Invalid invite token.");
        }

        if (invite.IsUsed)
        {
            return BadRequest("Invite token already used.");
        }

        if (invite.ExpiresAt <= DateTime.UtcNow)
        {
            return BadRequest("Invite token expired.");
        }

        var user = new AppUser
        {
            UserName = userName,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRole.Worker
        };

        db.Users.Add(user);

        invite.UsedAt = DateTime.UtcNow;
        invite.UsedByUserId = user.Id;
        invite.UsedByUserName = user.UserName;

        await db.SaveChangesAsync();

        var (jwtToken, expiresAtUtc) = jwtTokenService.CreateToken(user);
        return Ok(new AuthResponse(jwtToken, expiresAtUtc, user.Role.ToString(), user.UserName));
    }

    [HttpPost("create-vip")]
    [Authorize(Roles = "Developer")]
    public async Task<ActionResult<AuthResponse>> CreateVip(CreateVipRequest request)
    {
        var userName = request.UserName.Trim();
        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest("Username and password are required.");
        }

        if (!PasswordPolicy.TryValidate(request.Password, out var passwordError))
        {
            return BadRequest($"{passwordError} Hint: {PasswordPolicy.Hint}");
        }

        if (await db.Users.AnyAsync(x => x.UserName == userName))
        {
            return Conflict("Username already exists.");
        }

        var user = new AppUser
        {
            UserName = userName,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRole.VIP
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        var (token, expiresAtUtc) = jwtTokenService.CreateToken(user);
        return Ok(new AuthResponse(token, expiresAtUtc, user.Role.ToString(), user.UserName));
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        var userName = request.UserName.Trim();
        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest("Username and password are required.");
        }

        var user = await db.Users.FirstOrDefaultAsync(x => x.UserName == userName);
        if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            return Unauthorized("Invalid credentials.");
        }

        var (token, expiresAtUtc) = jwtTokenService.CreateToken(user);
        return Ok(new AuthResponse(token, expiresAtUtc, user.Role.ToString(), user.UserName));
    }

    [HttpGet("me")]
    [Authorize]
    public ActionResult<object> Me()
    {
        return Ok(new
        {
            UserId = User.FindFirst("sub")?.Value,
            UserName = User.Identity?.Name,
            Role = User.FindFirst("http://schemas.microsoft.com/ws/2008/06/identity/claims/role")?.Value
        });
    }
}
