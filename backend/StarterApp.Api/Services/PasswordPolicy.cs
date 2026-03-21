using System.Text.RegularExpressions;

namespace StarterApp.Api.Services;

public static class PasswordPolicy
{
    private static readonly Regex UpperRegex = new("[A-Z]", RegexOptions.Compiled);
    private static readonly Regex LowerRegex = new("[a-z]", RegexOptions.Compiled);
    private static readonly Regex DigitRegex = new("[0-9]", RegexOptions.Compiled);
    private static readonly Regex SpecialRegex = new("[^a-zA-Z0-9]", RegexOptions.Compiled);

    public static bool TryValidate(string password, out string error)
    {
        if (string.IsNullOrWhiteSpace(password))
        {
            error = "Password is required.";
            return false;
        }

        if (password.Length < 8)
        {
            error = "Password must be at least 8 characters.";
            return false;
        }

        if (!UpperRegex.IsMatch(password) || !LowerRegex.IsMatch(password) || !DigitRegex.IsMatch(password) || !SpecialRegex.IsMatch(password))
        {
            error = "Password must include uppercase, lowercase, number, and special character.";
            return false;
        }

        error = string.Empty;
        return true;
    }

    public static string Hint => "Min 8 chars, include: A-Z, a-z, 0-9, and special symbol (e.g. !@#$).";
}
