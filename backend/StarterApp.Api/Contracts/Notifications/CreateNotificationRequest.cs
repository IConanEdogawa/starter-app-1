namespace StarterApp.Api.Contracts.Notifications;

public sealed record CreateNotificationRequest(
    string Title,
    string Message,
    string? RelatedType,
    string? RelatedId,
    string? TargetRole
);
