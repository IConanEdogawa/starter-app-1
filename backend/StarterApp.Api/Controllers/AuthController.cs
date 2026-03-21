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
    private static readonly HashSet<string> AllowedRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "VIP", "Worker", "Developer"
    };

    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
    {
        var userName = request.UserName.Trim();
        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest("Username and password are required.");
        }

        if (request.Password.Length < 6)
        {
            return BadRequest("Password must be at least 6 characters.");
        }

        if (await db.Users.AnyAsync(x => x.UserName == userName))
        {
            return Conflict("Username already exists.");
        }

        var role = string.IsNullOrWhiteSpace(request.Role) ? "Worker" : request.Role.Trim();
        if (!AllowedRoles.Contains(role))
        {
            return BadRequest("Role must be one of: VIP, Worker, Developer.");
        }

        var user = new AppUser
        {
            UserName = userName,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = role
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        var (token, expiresAtUtc) = jwtTokenService.CreateToken(user);
        return Ok(new AuthResponse(token, expiresAtUtc, user.Role, user.UserName));
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
        return Ok(new AuthResponse(token, expiresAtUtc, user.Role, user.UserName));
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
