namespace StarterApp.Api.Contracts.Worker;

public sealed record WorkerCashActionResponse(
    Guid Id,
    string UserName,
    string ActionType,
    decimal Amount,
    string Currency,
    string Note,
    DateTime ActionAt,
    DateTime CreatedAt
);
