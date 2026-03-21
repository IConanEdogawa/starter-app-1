namespace StarterApp.Api.Contracts.Auth;

public sealed record RegisterWorkerRequest(string UserName, string Password, string InviteToken);
