package agent

import (
	"context"
	"fmt"
	"log"
	"time"

	"magnemite/agent/internal/proto"
)

// One-off commands from the dashboard: the same root shell the install hooks
// get, invoked by hand instead of around an install.

// A command's output rides the socket, which caps a frame at 1 MB. Anything
// this long is someone dumping a file, and the tail is the useful part anyway.
const maxExecOutput = 64 * 1024

func (a *Agent) execCommand(msg proto.ExecCommand) {
	seconds := msg.TimeoutSeconds
	if seconds <= 0 {
		seconds = 60
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(seconds)*time.Second)
	defer cancel()

	log.Printf("exec: %s", msg.Command)
	// Shell, not Exec: an operator types `am force-stop x && am start y`, and
	// the install hooks already run through sh the same way.
	out, err := a.Sys.Shell(ctx, msg.Command)

	result := proto.ExecResult{
		Type:      "exec_result",
		CommandID: msg.CommandID,
		OK:        err == nil,
		Output:    truncateOutput(out),
	}
	if err != nil {
		// `out` is kept either way: a failing command's output is usually the
		// explanation, and the error alone is just an exit status.
		result.Error = err.Error()
		if ctx.Err() != nil {
			result.Error = fmt.Sprintf("timed out after %ds", seconds)
		}
	}
	_ = a.send(result)
}

func truncateOutput(out string) string {
	if len(out) <= maxExecOutput {
		return out
	}
	return "… truncated …\n" + out[len(out)-maxExecOutput:]
}
