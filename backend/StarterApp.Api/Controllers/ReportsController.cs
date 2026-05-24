using System.Globalization;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StarterApp.Api.Contracts.Reports;
using StarterApp.Api.Data;
using StarterApp.Api.Models;

namespace StarterApp.Api.Controllers;

[ApiController]
[Route("api/reports")]
[Authorize(Roles = "VIP,Developer")]
public sealed class ReportsController(AppDbContext db) : ControllerBase
{
    private const decimal WonPerUsd = 1350m;

    [HttpGet("snapshot")]
    public async Task<ActionResult<ExcelReportWorkbookResponse>> Snapshot([FromQuery] string? month = null)
    {
        await EnsureReportTablesAsync();
        var normalizedMonth = NormalizeMonth(month);
        return Ok(await BuildSnapshotAsync(normalizedMonth));
    }

    [HttpPost("expenses")]
    public async Task<ActionResult<ExcelReportItemDto>> CreateExpense([FromBody] CreateReportEntryRequest request)
    {
        await EnsureReportTablesAsync();
        if (string.IsNullOrWhiteSpace(request.Description) || request.Amount <= 0)
        {
            return BadRequest("Description and Amount are required.");
        }

        var entity = new ReportExpense
        {
            Description = request.Description.Trim(),
            Amount = request.Amount,
            Currency = NormalizeCurrency(request.Currency),
            Category = NormalizeCategory(request.Category),
            OccurredAtUtc = NormalizeDate(request.Date),
            CreatedAtUtc = NormalizeCreatedAt(request.CreatedAt)
        };

        db.ReportExpenses.Add(entity);
        await db.SaveChangesAsync();
        return Ok(ToDto(entity));
    }

    [HttpPost("profits")]
    public async Task<ActionResult<ExcelReportItemDto>> CreateProfit([FromBody] CreateReportEntryRequest request)
    {
        await EnsureReportTablesAsync();
        if (string.IsNullOrWhiteSpace(request.Description) || request.Amount <= 0)
        {
            return BadRequest("Description and Amount are required.");
        }

        var entity = new ReportProfit
        {
            Description = request.Description.Trim(),
            Amount = request.Amount,
            Currency = NormalizeCurrency(request.Currency),
            Category = NormalizeCategory(request.Category),
            OccurredAtUtc = NormalizeDate(request.Date),
            CreatedAtUtc = NormalizeCreatedAt(request.CreatedAt)
        };

        db.ReportProfits.Add(entity);
        await db.SaveChangesAsync();
        return Ok(ToDto(entity));
    }

    [HttpGet("excel/export")]
    public async Task<ActionResult> Export([FromQuery] string? month = null)
    {
        await EnsureReportTablesAsync();
        var normalizedMonth = NormalizeMonth(month);
        var snapshot = await BuildSnapshotAsync(normalizedMonth);

        using var workbook = new XLWorkbook();
        var summarySheet = workbook.Worksheets.Add("Summary");
        var expensesSheet = workbook.Worksheets.Add("Expenses");
        var profitsSheet = workbook.Worksheets.Add("Profits");
        var weeksSheet = workbook.Worksheets.Add("4Weeks");

        WriteSummarySheet(summarySheet, snapshot.Month, snapshot.Expenses, snapshot.Profits);
        WriteRowsSheet(expensesSheet, snapshot.Expenses);
        WriteRowsSheet(profitsSheet, snapshot.Profits);
        WriteWeeksSheet(weeksSheet, snapshot.Expenses, snapshot.Profits);

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"report_{snapshot.Month}.xlsx");
    }

    [HttpPost("excel/import")]
    [RequestSizeLimit(15_000_000)]
    public async Task<ActionResult<ExcelReportWorkbookResponse>> Import([FromForm] IFormFile workbook)
    {
        await EnsureReportTablesAsync();
        if (workbook is null || workbook.Length <= 0)
        {
            return BadRequest("Workbook file is empty.");
        }

        await using var stream = workbook.OpenReadStream();
        using var parsedWorkbook = new XLWorkbook(stream);

        var summarySheet = FindWorksheet(parsedWorkbook, "Summary");
        var expensesSheet = FindWorksheet(parsedWorkbook, "Expenses");
        var profitsSheet = FindWorksheet(parsedWorkbook, "Profits");

        if (summarySheet is null || expensesSheet is null || profitsSheet is null)
        {
            return BadRequest("Workbook must contain Summary, Expenses and Profits sheets.");
        }

        var month = NormalizeMonth(summarySheet.Cell(1, 2).GetString());
        var expenseRows = ReadRowsSheet(expensesSheet).Select(ToExpenseEntity).ToList();
        var profitRows = ReadRowsSheet(profitsSheet).Select(ToProfitEntity).ToList();

        await using var transaction = await db.Database.BeginTransactionAsync();
        try
        {
            db.ReportExpenses.RemoveRange(db.ReportExpenses);
            db.ReportProfits.RemoveRange(db.ReportProfits);
            await db.SaveChangesAsync();

            if (expenseRows.Count > 0)
            {
                await db.ReportExpenses.AddRangeAsync(expenseRows);
            }

            if (profitRows.Count > 0)
            {
                await db.ReportProfits.AddRangeAsync(profitRows);
            }

            await db.SaveChangesAsync();
            await transaction.CommitAsync();
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }

        return Ok(await BuildSnapshotAsync(month));
    }

    private async Task<ExcelReportWorkbookResponse> BuildSnapshotAsync(string month)
    {
        var (startUtc, endUtc) = GetMonthRange(month);

        var expenses = await db.ReportExpenses
            .Where(x => x.OccurredAtUtc >= startUtc && x.OccurredAtUtc < endUtc)
            .OrderByDescending(x => x.OccurredAtUtc)
            .Select(x => ToDto(x))
            .ToListAsync();

        var profits = await db.ReportProfits
            .Where(x => x.OccurredAtUtc >= startUtc && x.OccurredAtUtc < endUtc)
            .OrderByDescending(x => x.OccurredAtUtc)
            .Select(x => ToDto(x))
            .ToListAsync();

        return new ExcelReportWorkbookResponse(month, expenses, profits, DateTime.UtcNow);
    }

    private static ExcelReportItemDto ToDto(ReportExpense x) => new(
        x.Id.ToString(),
        x.Description,
        x.Amount,
        x.Currency,
        x.Category,
        x.OccurredAtUtc.ToString("O", CultureInfo.InvariantCulture),
        x.CreatedAtUtc.ToString("O", CultureInfo.InvariantCulture)
    );

    private static ExcelReportItemDto ToDto(ReportProfit x) => new(
        x.Id.ToString(),
        x.Description,
        x.Amount,
        x.Currency,
        x.Category,
        x.OccurredAtUtc.ToString("O", CultureInfo.InvariantCulture),
        x.CreatedAtUtc.ToString("O", CultureInfo.InvariantCulture)
    );

    private static ReportExpense ToExpenseEntity(ExcelReportItemDto item) => new()
    {
        Id = TryParseGuid(item.Id),
        Description = item.Description,
        Amount = item.Amount,
        Currency = NormalizeCurrency(item.Currency),
        Category = NormalizeCategory(item.Category),
        OccurredAtUtc = NormalizeDate(item.Date),
        CreatedAtUtc = NormalizeCreatedAt(item.CreatedAt)
    };

    private static ReportProfit ToProfitEntity(ExcelReportItemDto item) => new()
    {
        Id = TryParseGuid(item.Id),
        Description = item.Description,
        Amount = item.Amount,
        Currency = NormalizeCurrency(item.Currency),
        Category = NormalizeCategory(item.Category),
        OccurredAtUtc = NormalizeDate(item.Date),
        CreatedAtUtc = NormalizeCreatedAt(item.CreatedAt)
    };

    private static IReadOnlyList<ExcelReportItemDto> ReadRowsSheet(IXLWorksheet sheet)
    {
        var headerMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var firstRow = sheet.FirstRowUsed();
        if (firstRow is null)
        {
            return Array.Empty<ExcelReportItemDto>();
        }

        foreach (var cell in firstRow.CellsUsed())
        {
            var header = cell.GetString().Trim();
            if (!string.IsNullOrWhiteSpace(header))
            {
                headerMap[header] = cell.Address.ColumnNumber;
            }
        }

        var rows = new List<ExcelReportItemDto>();
        foreach (var row in sheet.RowsUsed().Skip(1))
        {
            var id = ReadString(row, headerMap, "Id");
            var description = ReadString(row, headerMap, "Description");
            if (string.IsNullOrWhiteSpace(id) && string.IsNullOrWhiteSpace(description))
            {
                continue;
            }

            rows.Add(new ExcelReportItemDto(
                id,
                description,
                ReadDecimal(row, headerMap, "Amount"),
                ReadString(row, headerMap, "Currency"),
                ReadString(row, headerMap, "Category"),
                ReadString(row, headerMap, "Date"),
                ReadString(row, headerMap, "CreatedAt")
            ));
        }

        return rows;
    }

    private static void WriteSummarySheet(IXLWorksheet sheet, string month, IReadOnlyList<ExcelReportItemDto> expenses, IReadOnlyList<ExcelReportItemDto> profits)
    {
        sheet.Cell(1, 1).Value = "Month";
        sheet.Cell(1, 2).Value = month;
        sheet.Cell(2, 1).Value = "GeneratedAtUtc";
        sheet.Cell(2, 2).Value = DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        sheet.Cell(4, 1).Value = "Metric";
        sheet.Cell(4, 2).Value = "Won";
        sheet.Cell(4, 3).Value = "Usd";
        sheet.Cell(4, 4).Value = "WonEquivalent";

        var expenseWon = expenses.Where(x => IsWon(x.Currency)).Sum(x => x.Amount);
        var expenseUsd = expenses.Where(x => IsUsd(x.Currency)).Sum(x => x.Amount);
        var profitWon = profits.Where(x => IsWon(x.Currency)).Sum(x => x.Amount);
        var profitUsd = profits.Where(x => IsUsd(x.Currency)).Sum(x => x.Amount);

        var rows = new[]
        {
            ("Expenses", expenseWon, expenseUsd, expenseWon + expenseUsd * WonPerUsd),
            ("Profits", profitWon, profitUsd, profitWon + profitUsd * WonPerUsd),
            ("Net", profitWon - expenseWon, profitUsd - expenseUsd, (profitWon + profitUsd * WonPerUsd) - (expenseWon + expenseUsd * WonPerUsd))
        };

        var rowIndex = 5;
        foreach (var row in rows)
        {
            sheet.Cell(rowIndex, 1).Value = row.Item1;
            sheet.Cell(rowIndex, 2).Value = row.Item2;
            sheet.Cell(rowIndex, 3).Value = row.Item3;
            sheet.Cell(rowIndex, 4).Value = row.Item4;
            rowIndex++;
        }

        sheet.Columns().AdjustToContents();
    }

    private static void WriteRowsSheet(IXLWorksheet sheet, IReadOnlyList<ExcelReportItemDto> rows)
    {
        var headers = new[] { "Id", "Description", "Amount", "Currency", "Category", "Date", "CreatedAt" };
        for (var column = 0; column < headers.Length; column++)
        {
            sheet.Cell(1, column + 1).Value = headers[column];
            sheet.Cell(1, column + 1).Style.Font.Bold = true;
        }

        var rowIndex = 2;
        foreach (var row in rows)
        {
            sheet.Cell(rowIndex, 1).Value = row.Id;
            sheet.Cell(rowIndex, 2).Value = row.Description;
            sheet.Cell(rowIndex, 3).Value = row.Amount;
            sheet.Cell(rowIndex, 4).Value = row.Currency;
            sheet.Cell(rowIndex, 5).Value = row.Category;
            sheet.Cell(rowIndex, 6).Value = row.Date ?? string.Empty;
            sheet.Cell(rowIndex, 7).Value = row.CreatedAt ?? string.Empty;
            rowIndex++;
        }

        sheet.Columns().AdjustToContents();
    }

    private static void WriteWeeksSheet(IXLWorksheet sheet, IReadOnlyList<ExcelReportItemDto> expenses, IReadOnlyList<ExcelReportItemDto> profits)
    {
        sheet.Cell(1, 1).Value = "Week";
        sheet.Cell(1, 2).Value = "Expense Won";
        sheet.Cell(1, 3).Value = "Expense Usd";
        sheet.Cell(1, 4).Value = "Profit Won";
        sheet.Cell(1, 5).Value = "Profit Usd";
        sheet.Cell(1, 6).Value = "Net WonEquivalent";
        sheet.Range(1, 1, 1, 6).Style.Font.Bold = true;

        for (var week = 1; week <= 4; week++)
        {
            var expenseRows = expenses.Where(x => GetWeekBucket(x) == week).ToList();
            var profitRows = profits.Where(x => GetWeekBucket(x) == week).ToList();
            var expenseWon = expenseRows.Where(x => IsWon(x.Currency)).Sum(x => x.Amount);
            var expenseUsd = expenseRows.Where(x => IsUsd(x.Currency)).Sum(x => x.Amount);
            var profitWon = profitRows.Where(x => IsWon(x.Currency)).Sum(x => x.Amount);
            var profitUsd = profitRows.Where(x => IsUsd(x.Currency)).Sum(x => x.Amount);

            sheet.Cell(week + 1, 1).Value = $"Week {week}";
            sheet.Cell(week + 1, 2).Value = expenseWon;
            sheet.Cell(week + 1, 3).Value = expenseUsd;
            sheet.Cell(week + 1, 4).Value = profitWon;
            sheet.Cell(week + 1, 5).Value = profitUsd;
            sheet.Cell(week + 1, 6).Value = (profitWon + profitUsd * WonPerUsd) - (expenseWon + expenseUsd * WonPerUsd);
        }

        sheet.Columns().AdjustToContents();
    }

    private static IXLWorksheet? FindWorksheet(XLWorkbook workbook, string name)
    {
        return workbook.Worksheets.FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
    }

    private static string ReadString(IXLRow row, IReadOnlyDictionary<string, int> headerMap, string header)
    {
        if (!headerMap.TryGetValue(header, out var columnNumber))
        {
            return string.Empty;
        }

        return row.Cell(columnNumber).GetString().Trim();
    }

    private static decimal ReadDecimal(IXLRow row, IReadOnlyDictionary<string, int> headerMap, string header)
    {
        if (!headerMap.TryGetValue(header, out var columnNumber))
        {
            return 0m;
        }

        var cell = row.Cell(columnNumber);
        if (cell.TryGetValue<decimal>(out var value))
        {
            return value;
        }

        return decimal.TryParse(cell.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out value)
            ? value
            : 0m;
    }

    private static int GetWeekBucket(ExcelReportItemDto item)
    {
        if (TryParseDate(item.Date, out var date) || TryParseDate(item.CreatedAt, out date))
        {
            return Math.Clamp(((date.Day - 1) / 7) + 1, 1, 4);
        }

        return 4;
    }

    private static bool TryParseDate(string? value, out DateTime date)
    {
        return DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out date)
            || DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out date);
    }

    private async Task EnsureReportTablesAsync()
    {
        const string createExpenses = """
            CREATE TABLE IF NOT EXISTS report_expenses (
                id uuid PRIMARY KEY,
                description character varying(500) NOT NULL,
                amount numeric(18,2) NOT NULL,
                currency character varying(8) NOT NULL,
                category character varying(120) NOT NULL,
                occurred_at_utc timestamp without time zone NOT NULL,
                created_at_utc timestamp without time zone NOT NULL
            );
            """;

        const string createProfits = """
            CREATE TABLE IF NOT EXISTS report_profits (
                id uuid PRIMARY KEY,
                description character varying(500) NOT NULL,
                amount numeric(18,2) NOT NULL,
                currency character varying(8) NOT NULL,
                category character varying(120) NOT NULL,
                occurred_at_utc timestamp without time zone NOT NULL,
                created_at_utc timestamp without time zone NOT NULL
            );
            """;

        await db.Database.ExecuteSqlRawAsync(createExpenses);
        await db.Database.ExecuteSqlRawAsync(createProfits);
    }

    private static bool IsWon(string? currency) => string.Equals(currency, "won", StringComparison.OrdinalIgnoreCase);

    private static bool IsUsd(string? currency) => string.Equals(currency, "usd", StringComparison.OrdinalIgnoreCase);

    private static (DateTime StartUtc, DateTime EndUtc) GetMonthRange(string month)
    {
        var normalized = NormalizeMonth(month);
        var startUtc = DateTime.ParseExact(normalized + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
        return (startUtc, startUtc.AddMonths(1));
    }

    private static string NormalizeMonth(string? month)
    {
        if (string.IsNullOrWhiteSpace(month))
        {
            return DateTime.UtcNow.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        }

        month = month.Trim();
        if (DateTime.TryParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return date.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        }

        return DateTime.UtcNow.ToString("yyyy-MM", CultureInfo.InvariantCulture);
    }

    private static string NormalizeCurrency(string? currency)
    {
        return string.Equals(currency?.Trim(), "usd", StringComparison.OrdinalIgnoreCase) ? "usd" : "won";
    }

    private static string NormalizeCategory(string? category)
    {
        var value = category?.Trim();
        return string.IsNullOrWhiteSpace(value) ? "Boshqa" : value;
    }

    private static DateTime NormalizeDate(string? value)
    {
        if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var date))
        {
            return date.ToUniversalTime();
        }

        if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out date))
        {
            return date;
        }

        return DateTime.UtcNow;
    }

    private static DateTime NormalizeCreatedAt(DateTime? value)
    {
        return value?.ToUniversalTime() ?? DateTime.UtcNow;
    }

    private static DateTime NormalizeCreatedAt(string? value)
    {
        if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var date))
        {
            return date.ToUniversalTime();
        }

        if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out date))
        {
            return date;
        }

        return DateTime.UtcNow;
    }

    private static Guid TryParseGuid(string? value)
    {
        return Guid.TryParse(value, out var parsed) ? parsed : Guid.NewGuid();
    }
}