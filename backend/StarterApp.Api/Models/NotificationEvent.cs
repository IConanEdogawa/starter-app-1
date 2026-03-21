namespace StarterApp.Api.Models;

public sealed class NotificationEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CreatedByUserId { get; set; }
    public string CreatedByUserName { get; set; } = string.Empty;
    public string TargetRole { get; set; } = "Worker";
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string RelatedType { get; set; } = string.Empty;
    public string RelatedId { get; set; } = string.Empty;
    public bool IsAcknowledged { get; set; }
    public DateTime? AcknowledgedAt { get; set; }
    public Guid? AcknowledgedByUserId { get; set; }
    public string? AcknowledgedByUserName { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
