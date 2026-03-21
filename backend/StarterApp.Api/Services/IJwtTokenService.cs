using StarterApp.Api.Models;

namespace StarterApp.Api.Services;

public interface IJwtTokenService
{
    (string Token, DateTime ExpiresAtUtc) CreateToken(AppUser user);
}
