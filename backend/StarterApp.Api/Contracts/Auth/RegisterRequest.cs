namespace StarterApp.Api.Contracts.Auth;

public sealed record RegisterRequest(string UserName, string Password, string Role);
