/** Public support inbox. Configure only after the mailbox receives messages. */
export function supportEmail() {
  const email = process.env.SUPPORT_EMAIL?.trim();
  return email && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email) ? email : null;
}
