package tinybird

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

// Datasource names kept for backward compatibility with event context logging
const (
	DatasourceHTTP = "http"
	DatasourceTCP  = "tcp"
	DatasourceDNS  = "dns"
)

// Client interface — now writes to SQLite instead of Tinybird
type Client interface {
	SendEvent(ctx context.Context, event any, dataSourceName string) error
}

type client struct {
	db *sqlx.DB
}

// NewClient creates a new client that writes to SQLite
func NewClient(db *sqlx.DB) Client {
	return &client{db: db}
}

// SendEvent inserts a monitoring result into the monitor_result table
func (c *client) SendEvent(ctx context.Context, event any, dataSourceName string) error {
	// Marshal to JSON and back to map for uniform field access
	jsonBytes, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("unable to marshal event: %w", err)
	}

	var fields map[string]any
	if err := json.Unmarshal(jsonBytes, &fields); err != nil {
		return fmt.Errorf("unable to unmarshal event: %w", err)
	}

	monitorID := toInt64(fields["monitorId"])
	workspaceID := toInt64(fields["workspaceId"])
	region := toString(fields["region"])
	latency := toInt64(fields["latency"])
	requestStatus := toString(fields["requestStatus"])
	message := toString(fields["errorMessage"])
	trigger := toString(fields["trigger"])
	if trigger == "" {
		trigger = "cron"
	}

	// Determine request status if not set
	if requestStatus == "" {
		errorVal := toInt64(fields["error"])
		if errorVal > 0 {
			requestStatus = "error"
		} else {
			requestStatus = "success"
		}
	}

	now := time.Now().Unix()

	switch dataSourceName {
	case DatasourceHTTP:
		statusCode := toIntPtr(fields["statusCode"])
		timing := parseHTTPTiming(toString(fields["timing"]))

		_, err = c.db.ExecContext(ctx,
			`INSERT INTO monitor_result
			(monitor_id, workspace_id, job_type, region, status_code, latency, request_status, message,
			 timing_dns, timing_connection, timing_tls, timing_ttfb, timing_transfer, trigger, created_at)
			VALUES (?, ?, 'http', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			monitorID, workspaceID, region, statusCode, latency, requestStatus, message,
			timing.dns, timing.connection, timing.tls, timing.ttfb, timing.transfer,
			trigger, now,
		)

	case DatasourceTCP:
		_, err = c.db.ExecContext(ctx,
			`INSERT INTO monitor_result
			(monitor_id, workspace_id, job_type, region, latency, request_status, message, trigger, created_at)
			VALUES (?, ?, 'tcp', ?, ?, ?, ?, ?, ?)`,
			monitorID, workspaceID, region, latency, requestStatus, message, trigger, now,
		)

	case DatasourceDNS:
		_, err = c.db.ExecContext(ctx,
			`INSERT INTO monitor_result
			(monitor_id, workspace_id, job_type, region, latency, request_status, message, trigger, created_at)
			VALUES (?, ?, 'dns', ?, ?, ?, ?, ?, ?)`,
			monitorID, workspaceID, region, latency, requestStatus, message, trigger, now,
		)

	default:
		return fmt.Errorf("unknown datasource: %s", dataSourceName)
	}

	if err != nil {
		return fmt.Errorf("unable to insert monitor_result: %w", err)
	}
	return nil
}

type httpTiming struct {
	dns        *int64
	connection *int64
	tls        *int64
	ttfb       *int64
	transfer   *int64
}

// parseHTTPTiming parses the JSON timing string from the checker
// Format: {"dnsStart":0,"dnsDone":10,"connectStart":10,"connectDone":30,...}
func parseHTTPTiming(timingJSON string) httpTiming {
	t := httpTiming{}
	if timingJSON == "" {
		return t
	}

	var timing map[string]any
	if err := json.Unmarshal([]byte(timingJSON), &timing); err != nil {
		return t
	}

	// Calculate phase durations from absolute timestamps
	dnsStart := toFloat64(timing["dnsStart"])
	dnsDone := toFloat64(timing["dnsDone"])
	connectStart := toFloat64(timing["connectStart"])
	connectDone := toFloat64(timing["connectDone"])
	tlsStart := toFloat64(timing["tlsHandshakeStart"])
	tlsDone := toFloat64(timing["tlsHandshakeDone"])
	firstByteTime := toFloat64(timing["firstByteTime"])
	transferStart := toFloat64(timing["transferStart"])
	transferDone := toFloat64(timing["transferDone"])

	if dnsDone > 0 {
		v := int64(dnsDone - dnsStart)
		t.dns = &v
	}
	if connectDone > 0 {
		v := int64(connectDone - connectStart)
		t.connection = &v
	}
	if tlsDone > 0 {
		v := int64(tlsDone - tlsStart)
		t.tls = &v
	}
	if firstByteTime > 0 {
		// TTFB = time from connection done to first byte
		base := connectDone
		if tlsDone > 0 {
			base = tlsDone
		}
		v := int64(firstByteTime - base)
		t.ttfb = &v
	}
	if transferDone > 0 && transferStart > 0 {
		v := int64(transferDone - transferStart)
		t.transfer = &v
	}

	return t
}

func toInt64(v any) int64 {
	switch val := v.(type) {
	case float64:
		return int64(val)
	case int64:
		return val
	case int:
		return int64(val)
	case string:
		n, _ := strconv.ParseInt(val, 10, 64)
		return n
	case json.Number:
		n, _ := val.Int64()
		return n
	}
	return 0
}

func toIntPtr(v any) *int64 {
	switch val := v.(type) {
	case float64:
		n := int64(val)
		return &n
	case int64:
		return &val
	case int:
		n := int64(val)
		return &n
	case string:
		n, err := strconv.ParseInt(val, 10, 64)
		if err != nil {
			return nil
		}
		return &n
	}
	return nil
}

func toString(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case fmt.Stringer:
		return val.String()
	}
	return ""
}

func toFloat64(v any) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case int64:
		return float64(val)
	case int:
		return float64(val)
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(val), 64)
		return f
	}
	return 0
}
