namespace StarterApp.Api.Contracts.Worker;

public sealed record CreateWorkerCashActionRequest(
    string ActionType,
    decimal Amount,
    string Currency,
    string? Note,
    DateTime? ActionAt
);
