using Microsoft.EntityFrameworkCore;
using StarterApp.Api.Data;
using StarterApp.Api.Models;

namespace StarterApp.Api.Services;

public static class DeveloperSeedService
{
    public static async Task EnsureDeveloperAsync(AppDbContext db, IConfiguration configuration, CancellationToken ct = default)
    {
        var enabled = configuration.GetValue<bool?>("DeveloperSeed:Enabled") ?? true;
        if (!enabled) return;

        var userName = configuration["DeveloperSeed:UserName"]?.Trim();
        var password = configuration["DeveloperSeed:Password"];

        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(password))
        {
            return;
        }

        var existing = await db.Users.FirstOrDefaultAsync(x => x.UserName == userName, ct);
        if (existing is not null)
        {
            if (existing.Role != UserRole.Developer)
            {
                existing.Role = UserRole.Developer;
                await db.SaveChangesAsync(ct);
            }
            return;
        }

        var user = new AppUser
        {
            UserName = userName,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = UserRole.Developer,
            CreatedAt = DateTime.UtcNow
        };

        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
    }
}
