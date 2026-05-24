namespace StarterApp.Api.Contracts.Reports;

public sealed record ExcelReportWorkbookResponse(
    string Month,
    IReadOnlyList<ExcelReportItemDto> Expenses,
    IReadOnlyList<ExcelReportItemDto> Profits,
    DateTime GeneratedAtUtc
);