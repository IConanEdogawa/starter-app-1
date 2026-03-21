namespace StarterApp.Api.Contracts.Auth;

public sealed record AuthResponse(string Token, DateTime ExpiresAtUtc, string Role, string UserName);
