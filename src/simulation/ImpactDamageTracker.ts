/** Re-arm only after separation; a sustained contact is one impact, not a timer. */
export class ImpactDamageTracker {
  private armed = true;
  private separatedSeconds = 0;

  sample(contact: 'NONE' | 'CAR' | 'BARRIER', dt: number): boolean {
    if (contact === 'NONE') {
      this.separatedSeconds += Math.max(0, dt);
      if (this.separatedSeconds >= 0.15) this.armed = true;
      return false;
    }
    this.separatedSeconds = 0;
    const impact = this.armed;
    this.armed = false;
    return impact;
  }

  reset(): void {
    this.armed = true;
    this.separatedSeconds = 0;
  }
}
