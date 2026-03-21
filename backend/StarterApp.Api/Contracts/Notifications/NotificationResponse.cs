namespace StarterApp.Api.Contracts.Notifications;

public sealed record NotificationResponse(
    Guid Id,
    string CreatedByUserName,
    string TargetRole,
    string Title,
    string Message,
    string RelatedType,
    string RelatedId,
    bool IsAcknowledged,
    DateTime? AcknowledgedAt,
    string? AcknowledgedByUserName,
    DateTime CreatedAt
);
