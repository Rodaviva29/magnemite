package monitor

import "testing"

// The dumpsys output below is the real shape from several Android versions.
// This parsing is the part most likely to be wrong on odd TV-box ROMs, and it
// is also the part with the worst failure mode: read the wrong package and the
// "pogo not in focus" rule force-stops a healthy game every beat.
func TestParseFocused(t *testing.T) {
	const pogo = "com.nianticlabs.pokemongo"

	cases := []struct {
		name string
		out  string
		want string
	}{
		{
			name: "mFocusedApp with a relative component",
			out:  "  mFocusedApp=ActivityRecord{1a2b3c u0 " + pogo + "/.MainActivity t42}",
			want: pogo,
		},
		{
			name: "mFocusedApp with a fully qualified component",
			out:  "mFocusedApp=ActivityRecord{d4e5f6 u0 " + pogo + "/" + pogo + ".UnityPlayerActivity t7}",
			want: pogo,
		},
		{
			name: "the launcher is null, not a parse failure",
			out:  "  mFocusedApp=null",
			want: "",
		},
		// Android 10+ moved the answer; both keys are usually printed.
		{
			name: "falls back to topResumedActivity",
			out: "  mFocusedApp=null\n" +
				"  topResumedActivity=ActivityRecord{99 u0 " + pogo + "/.MainActivity t3}",
			want: pogo,
		},
		{
			name: "falls back to mCurrentFocus from dumpsys window",
			out:  "  mCurrentFocus=Window{aa bb u0 " + pogo + "/" + pogo + ".MainActivity}",
			want: pogo,
		},
		// mFocusedApp wins even when it is printed after the others, because
		// the loop is ordered by key rather than by line.
		{
			name: "mFocusedApp beats a stale mResumedActivity",
			out: "  mResumedActivity=ActivityRecord{11 u0 com.pokemod.aegis/.Main t1}\n" +
				"  mFocusedApp=ActivityRecord{22 u0 " + pogo + "/.MainActivity t2}",
			want: pogo,
		},
		{
			name: "nothing parseable",
			out:  "",
			want: "",
		},
		{
			name: "a box that prints the key with no activity at all",
			out:  "  mFocusedApp=<empty>",
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseFocused(tc.out); got != tc.want {
				t.Errorf("parseFocused() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestParseANR(t *testing.T) {
	cases := []struct {
		name string
		out  string
		want []string
	}{
		{
			name: "the dialog line",
			out:  "  Window{1 u0 Application Not Responding: com.nianticlabs.pokemongo}",
			want: []string{"com.nianticlabs.pokemongo"},
		},
		{
			name: "no colon, as some builds print it",
			out:  "ANR in Application Not Responding com.pokemod.aegis",
			want: []string{"com.pokemod.aegis"},
		},
		// The same ANR shows up in both dumpsys outputs the probe concatenates.
		{
			name: "the same package from both sources is reported once",
			out: "Application Not Responding: com.nianticlabs.pokemongo\n" +
				"Application Not Responding: com.nianticlabs.pokemongo",
			want: []string{"com.nianticlabs.pokemongo"},
		},
		{
			name: "nothing responding badly",
			out:  "",
			want: nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseANR(tc.out)
			if len(got) != len(tc.want) {
				t.Fatalf("parseANR() = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("parseANR()[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestSplitLogRead(t *testing.T) {
	now, mtime, window := splitLogRead("1700000100\n1700000000\nfirst\nsecond\n")
	if now != 1700000100 || mtime != 1700000000 {
		t.Errorf("header = (%d, %d), want (1700000100, 1700000000)", now, mtime)
	}
	if window != "first\nsecond\n" {
		t.Errorf("window = %q", window)
	}

	// A box whose toybox has no `stat -c` echoes 0, which has to skip the age
	// test rather than read as "written in 1970" and fail every check.
	_, mtime, _ = splitLogRead("1700000100\n0\nline\n")
	if mtime != 0 {
		t.Errorf("missing stat should give mtime 0, got %d", mtime)
	}

	// An empty log still has its two header lines; only a completely empty
	// read means the file is not there.
	if _, _, window = splitLogRead("1700000100\n1700000000\n"); window != "" {
		t.Errorf("empty log window = %q, want empty", window)
	}
	if _, _, window = splitLogRead(""); window != "" {
		t.Errorf("empty read window = %q, want empty", window)
	}
}

func TestTruncate(t *testing.T) {
	long := make([]byte, maxDetail+100)
	for i := range long {
		long[i] = 'x'
	}
	got := truncate(string(long))
	if len(got) != maxDetail+len("…") {
		t.Errorf("truncate kept %d bytes, want %d", len(got), maxDetail+len("…"))
	}
	if short := truncate("fine"); short != "fine" {
		t.Errorf("truncate(%q) = %q", "fine", short)
	}
}
