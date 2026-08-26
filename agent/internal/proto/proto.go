// Package proto mirrors packages/protocol/src/index.ts. Change both together.
//
// Compatibility rule: agents update themselves over the air and a box that
// sat powered off for a month reconnects running an old build. Only ever add
// optional fields; never repurpose or remove one.
package proto

const Version = 1

// Job states, matching the JobState enum in the Prisma schema.
const (
	StateQueued      = "QUEUED"
	StateDispatched  = "DISPATCHED"
	StateDownloading = "DOWNLOADING"
	StateExtracting  = "EXTRACTING"
	StateInstalling  = "INSTALLING"
	StateVerifying   = "VERIFYING"
	StateSuccess     = "SUCCESS"
	StateFailed      = "FAILED"
	StateCancelled   = "CANCELLED"
)

const (
	InstallModeInPlace = "IN_PLACE"
	InstallModeClean   = "CLEAN"
)

const (
	LevelDebug = "DEBUG"
	LevelInfo  = "INFO"
	LevelWarn  = "WARN"
	LevelError = "ERROR"
)

type PackageInfo struct {
	PackageName string `json:"packageName"`
	VersionName string `json:"versionName,omitempty"`
	// String because an Android versionCode can exceed 2^31.
	VersionCode string `json:"versionCode,omitempty"`
	Installed   bool   `json:"installed"`
}

type DeviceInfo struct {
	Serial         string `json:"serial"`
	Manufacturer   string `json:"manufacturer,omitempty"`
	Model          string `json:"model,omitempty"`
	AndroidVersion string `json:"androidVersion,omitempty"`
	SdkInt         int    `json:"sdkInt,omitempty"`
	Abi            string `json:"abi,omitempty"`
	Density        int    `json:"density,omitempty"`
}

type DeviceMetrics struct {
	FreeBytes     uint64        `json:"freeBytes"`
	TotalBytes    uint64        `json:"totalBytes"`
	UptimeSeconds int64         `json:"uptimeSeconds"`
	Packages      []PackageInfo `json:"packages"`
	// True when Packages is the box's whole third-party inventory rather than
	// just the apps the hub asked about. The hub needs to know the difference:
	// only a complete list is evidence that something was uninstalled.
	PackagesComplete bool `json:"packagesComplete,omitempty"`

	// Cheap health signals, read straight out of /proc on every heartbeat.
	// Omitted by agents older than this field, which is why the hub treats
	// every one of them as optional.
	LoadAvg1          float64 `json:"loadAvg1,omitempty"`
	LoadAvg5          float64 `json:"loadAvg5,omitempty"`
	LoadAvg15         float64 `json:"loadAvg15,omitempty"`
	CPUCount          int     `json:"cpuCount,omitempty"`
	MemTotalBytes     uint64  `json:"memTotalBytes,omitempty"`
	MemAvailableBytes uint64  `json:"memAvailableBytes,omitempty"`
}

// --- agent -> hub ----------------------------------------------------------

type Hello struct {
	Type            string        `json:"type"` // "hello"
	ProtocolVersion int           `json:"protocolVersion"`
	AgentVersion    string        `json:"agentVersion"`
	Device          DeviceInfo    `json:"device"`
	Metrics         DeviceMetrics `json:"metrics"`
	CurrentJobID    string        `json:"currentJobId,omitempty"`
}

type Heartbeat struct {
	Type         string        `json:"type"` // "heartbeat"
	Metrics      DeviceMetrics `json:"metrics"`
	CurrentJobID string        `json:"currentJobId,omitempty"`
}

type JobProgress struct {
	Type     string `json:"type"` // "job_progress"
	JobID    string `json:"jobId"`
	State    string `json:"state"`
	Progress int    `json:"progress"`
	Message  string `json:"message,omitempty"`
}

type JobResult struct {
	Type                 string `json:"type"` // "job_result"
	JobID                string `json:"jobId"`
	OK                   bool   `json:"ok"`
	InstallMode          string `json:"installMode,omitempty"`
	DataWiped            bool   `json:"dataWiped"`
	InstalledVersion     string `json:"installedVersion,omitempty"`
	InstalledVersionCode string `json:"installedVersionCode,omitempty"`
	Error                string `json:"error,omitempty"`
}

type LogMessage struct {
	Type    string `json:"type"` // "log"
	JobID   string `json:"jobId,omitempty"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

// --- hub -> agent ----------------------------------------------------------

// Envelope is decoded first to find out which concrete message arrived.
type Envelope struct {
	Type string `json:"type"`
}

type Welcome struct {
	Type             string   `json:"type"`
	DeviceID         string   `json:"deviceId"`
	Name             string   `json:"name"`
	Approved         bool     `json:"approved"`
	HeartbeatSeconds int      `json:"heartbeatSeconds"`
	TrackedPackages  []string `json:"trackedPackages"`
}

type InstallJob struct {
	Type            string   `json:"type"`
	JobID           string   `json:"jobId"`
	PackageName     string   `json:"packageName"`
	URL             string   `json:"url"`
	SHA256          string   `json:"sha256"`
	SizeBytes       int64    `json:"sizeBytes"`
	Version         string   `json:"version"`
	ForceClean      bool     `json:"forceClean"`
	PreInstallHook  string   `json:"preInstallHook,omitempty"`
	PostInstallHook string   `json:"postInstallHook,omitempty"`
	ExtraSplits     []string `json:"extraSplits,omitempty"`
	TimeoutSeconds  int      `json:"timeoutSeconds"`
}

type CancelJob struct {
	Type  string `json:"type"`
	JobID string `json:"jobId"`
}

type AgentUpdate struct {
	Type    string `json:"type"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Version string `json:"version"`
}

// --- enrollment ------------------------------------------------------------

type EnrollRequest struct {
	EnrollmentToken string     `json:"enrollmentToken"`
	Name            string     `json:"name,omitempty"`
	AgentVersion    string     `json:"agentVersion"`
	Device          DeviceInfo `json:"device"`
}

type EnrollResponse struct {
	DeviceID    string `json:"deviceId"`
	DeviceToken string `json:"deviceToken"`
	Name        string `json:"name"`
	Approved    bool   `json:"approved"`
	WsURL       string `json:"wsUrl"`
}
