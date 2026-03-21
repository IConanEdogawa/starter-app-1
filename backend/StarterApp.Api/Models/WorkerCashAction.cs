namespace StarterApp.Api.Models;

public sealed class WorkerCashAction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string ActionType { get; set; } = string.Empty; // give | take
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "won"; // won | usd
    public string Note { get; set; } = string.Empty;
    public DateTime ActionAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
