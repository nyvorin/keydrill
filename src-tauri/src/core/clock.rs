use chrono::{DateTime, FixedOffset, Local, NaiveDateTime};

/// Time source. Every effectful caller passes one of these in, so domain logic
/// never reads the wall clock directly and tests stay deterministic.
pub trait Clock: Send + Sync {
    /// The only method an implementor must provide.
    fn now(&self) -> DateTime<Local>;

    /// Same instant, carried with an explicit numeric offset so pure functions
    /// can be tested without depending on the machine's timezone database.
    fn now_fixed(&self) -> DateTime<FixedOffset> {
        let n = self.now();
        let off = *n.offset();
        n.with_timezone(&off)
    }

    /// Epoch milliseconds.
    fn now_ms(&self) -> i64 {
        self.now().timestamp_millis()
    }

    /// Local calendar date as `YYYY-MM-DD`.
    fn today(&self) -> String {
        self.now().format("%Y-%m-%d").to_string()
    }
}

/// Production clock.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Local> {
        Local::now()
    }
}

/// Frozen clock: same instant forever. Used by unit tests and by store tests.
pub struct FixedClock {
    instant: DateTime<Local>,
}

impl FixedClock {
    /// `local_iso` is a NAIVE local timestamp — `"YYYY-MM-DDTHH:MM:SS"` — read in
    /// the machine's own timezone. Deliberately naive-local rather than an
    /// absolute instant: it makes `today()` and `hour()` assertions come out the
    /// same on every developer machine and on CI, whatever `TZ` says.
    pub fn new(local_iso: &str) -> Self {
        let naive = NaiveDateTime::parse_from_str(local_iso, "%Y-%m-%dT%H:%M:%S")
            .expect("FixedClock::new: expected 'YYYY-MM-DDTHH:MM:SS'");
        let instant = naive
            .and_local_timezone(Local)
            .earliest()
            .expect("FixedClock::new: that local time does not exist in this timezone");
        FixedClock { instant }
    }
}

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Local> {
        self.instant
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_clock_is_frozen() {
        let c = FixedClock::new("2026-08-17T09:30:00");
        assert_eq!(c.now_ms(), c.now_ms());
        assert_eq!(c.today(), c.today());
    }

    #[test]
    fn fixed_clock_reports_the_local_date_and_hour_it_was_given() {
        use chrono::Timelike;
        let c = FixedClock::new("2026-08-17T09:30:00");
        assert_eq!(c.today(), "2026-08-17");
        assert_eq!(c.now().hour(), 9);
    }

    #[test]
    fn fixed_clocks_an_hour_apart_are_an_hour_apart() {
        let a = FixedClock::new("2026-08-17T09:30:00");
        let b = FixedClock::new("2026-08-17T10:30:00");
        assert_eq!(b.now_ms() - a.now_ms(), 3_600_000);
    }

    #[test]
    fn now_fixed_round_trips_the_same_instant() {
        let c = FixedClock::new("2026-08-17T09:30:00");
        assert_eq!(c.now_fixed().timestamp_millis(), c.now_ms());
    }

    #[test]
    fn system_clock_advances_monotonically_enough() {
        let c = SystemClock;
        let first = c.now_ms();
        let second = c.now_ms();
        assert!(second >= first);
    }
}
