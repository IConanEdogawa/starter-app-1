namespace StarterApp.Api.Contracts.Reports;

public sealed record ExcelReportItemDto(
    string Id,
    string Description,
    decimal Amount,
    string Currency,
    string Category,
    string? Date,
    string? CreatedAt
);