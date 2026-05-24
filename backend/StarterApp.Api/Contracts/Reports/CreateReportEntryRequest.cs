namespace StarterApp.Api.Contracts.Reports;

public sealed record CreateReportEntryRequest(
    string Description,
    decimal Amount,
    string Currency,
    string? Category,
    string? Date,
    DateTime? CreatedAt
);