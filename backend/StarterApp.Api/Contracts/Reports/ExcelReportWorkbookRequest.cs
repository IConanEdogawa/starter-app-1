namespace StarterApp.Api.Contracts.Reports;

public sealed record ExcelReportWorkbookRequest(
    string Month,
    IReadOnlyList<ExcelReportItemDto> Expenses,
    IReadOnlyList<ExcelReportItemDto> Profits
);