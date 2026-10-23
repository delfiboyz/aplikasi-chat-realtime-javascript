// Applied before first paint to avoid a flash of the wrong theme.
try {
  const theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  /* storage unavailable: fall back to the system theme */
}
