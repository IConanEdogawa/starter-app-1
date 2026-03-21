namespace StarterApp.Api.Models;

public sealed class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserName { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = "Worker";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
