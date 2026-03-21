namespace StarterApp.Api.Contracts.Invites;

public sealed record WorkerInviteResponse(
    string Token,
    string Link,
    DateTime ExpiresAtUtc,
    DateTime CreatedAtUtc,
    bool IsUsed
);
