using Microsoft.EntityFrameworkCore;
using StarterApp.Api.Models;

namespace StarterApp.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<WorkerCashAction> WorkerCashActions => Set<WorkerCashAction>();
    public DbSet<NotificationEvent> Notifications => Set<NotificationEvent>();
    public DbSet<ReportExpense> ReportExpenses => Set<ReportExpense>();
    public DbSet<ReportProfit> ReportProfits => Set<ReportProfit>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.UserName).HasMaxLength(100).IsRequired();
            entity.Property(x => x.PasswordHash).IsRequired();
            entity.Property(x => x.Role)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();
            entity.HasIndex(x => x.UserName).IsUnique();
        });

        modelBuilder.Entity<WorkerCashAction>(entity =>
        {
            entity.ToTable("worker_cash_actions");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.UserName).HasMaxLength(100).IsRequired();
            entity.Property(x => x.ActionType).HasMaxLength(16).IsRequired();
            entity.Property(x => x.Currency).HasMaxLength(8).IsRequired();
            entity.Property(x => x.Note).HasMaxLength(500);
            entity.Property(x => x.Amount).HasPrecision(18, 2);
            entity.HasIndex(x => x.ActionAt);
        });

        modelBuilder.Entity<NotificationEvent>(entity =>
        {
            entity.ToTable("notifications");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.CreatedByUserName).HasMaxLength(100).IsRequired();
            entity.Property(x => x.TargetRole).HasMaxLength(32).IsRequired();
            entity.Property(x => x.Title).HasMaxLength(200).IsRequired();
            entity.Property(x => x.Message).HasMaxLength(2000).IsRequired();
            entity.Property(x => x.RelatedType).HasMaxLength(64).IsRequired();
            entity.Property(x => x.RelatedId).HasMaxLength(128).IsRequired();
            entity.Property(x => x.AcknowledgedByUserName).HasMaxLength(100);
            entity.HasIndex(x => new { x.TargetRole, x.IsAcknowledged, x.CreatedAt });
        });

        modelBuilder.Entity<WorkerInvite>(entity =>
        {
            entity.ToTable("worker_invites");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Token).HasMaxLength(120).IsRequired();
            entity.Property(x => x.CreatedByUserName).HasMaxLength(100).IsRequired();
            entity.Property(x => x.UsedByUserName).HasMaxLength(100);
            entity.HasIndex(x => x.Token).IsUnique();
            entity.HasIndex(x => x.ExpiresAt);
        });

        modelBuilder.Entity<ReportExpense>(entity =>
        {
            entity.ToTable("report_expenses");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Id).HasColumnName("id");
            entity.Property(x => x.Description).HasColumnName("description");
            entity.Property(x => x.Amount).HasColumnName("amount");
            entity.Property(x => x.Currency).HasColumnName("currency");
            entity.Property(x => x.Category).HasColumnName("category");
            entity.Property(x => x.OccurredAtUtc).HasColumnName("occurred_at_utc");
            entity.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc");
            entity.Property(x => x.Description).HasMaxLength(500).IsRequired();
            entity.Property(x => x.Currency).HasMaxLength(8).IsRequired();
            entity.Property(x => x.Category).HasMaxLength(120).IsRequired();
            entity.Property(x => x.Amount).HasPrecision(18, 2);
            entity.HasIndex(x => x.OccurredAtUtc);
            entity.HasIndex(x => x.CreatedAtUtc);
        });

        modelBuilder.Entity<ReportProfit>(entity =>
        {
            entity.ToTable("report_profits");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Id).HasColumnName("id");
            entity.Property(x => x.Description).HasColumnName("description");
            entity.Property(x => x.Amount).HasColumnName("amount");
            entity.Property(x => x.Currency).HasColumnName("currency");
            entity.Property(x => x.Category).HasColumnName("category");
            entity.Property(x => x.OccurredAtUtc).HasColumnName("occurred_at_utc");
            entity.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc");
            entity.Property(x => x.Description).HasMaxLength(500).IsRequired();
            entity.Property(x => x.Currency).HasMaxLength(8).IsRequired();
            entity.Property(x => x.Category).HasMaxLength(120).IsRequired();
            entity.Property(x => x.Amount).HasPrecision(18, 2);
            entity.HasIndex(x => x.OccurredAtUtc);
            entity.HasIndex(x => x.CreatedAtUtc);
        });
    }

    public DbSet<WorkerInvite> WorkerInvites => Set<WorkerInvite>();
}
