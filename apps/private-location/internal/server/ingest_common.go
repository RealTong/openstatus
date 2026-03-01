package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/openstatushq/openstatus/apps/private-location/internal/database"
)

// ingestContext holds common data needed for ingestion
type ingestContext struct {
	Monitor database.Monitor
	Region  database.PrivateLocation
}

// getIngestContext retrieves monitor and private location data for ingestion
func (h *privateLocationHandler) getIngestContext(ctx context.Context, token string, monitorID string) (*ingestContext, error) {
	var monitor database.Monitor
	err := h.db.Get(&monitor, "SELECT monitor.id, monitor.workspace_id, monitor.url, monitor.method, monitor.assertions FROM monitor JOIN private_location_to_monitor a ON monitor.id = a.monitor_id JOIN private_location b ON a.private_location_id = b.id WHERE b.token = ? AND monitor.deleted_at IS NULL and monitor.id = ?", token, monitorID)
	if err != nil {
		if holder := GetEvent(ctx); holder != nil {
			holder.Event["error"] = map[string]any{
				"message": err.Error(),
				"source":  "database",
				"type":    "monitor_lookup",
			}
		}
		return nil, err
	}

	var region database.PrivateLocation
	err = h.db.Get(&region, "SELECT private_location.id FROM private_location join private_location_to_monitor a ON private_location.id = a.private_location_id WHERE a.monitor_id = ? AND private_location.token = ?", monitor.ID, token)
	if err != nil {
		if holder := GetEvent(ctx); holder != nil {
			holder.Event["error"] = map[string]any{
				"message": err.Error(),
				"source":  "database",
				"type":    "private_location_lookup",
			}
		}
		return nil, err
	}

	return &ingestContext{
		Monitor: monitor,
		Region:  region,
	}, nil
}

// sendEventAndUpdateLastSeen writes the event to SQLite and updates the last_seen_at timestamp
func (h *privateLocationHandler) sendEventAndUpdateLastSeen(ctx context.Context, data any, dataSourceName string, regionID int) {
	start := time.Now()
	err := h.dbWriter.SendEvent(ctx, data, dataSourceName)
	duration := time.Since(start).Milliseconds()

	// Enrich wide event with DB write context
	if holder := GetEvent(ctx); holder != nil {
		holder.Event["db_write"] = map[string]any{
			"datasource":  dataSourceName,
			"duration_ms": duration,
			"success":     err == nil,
		}
		if err != nil {
			holder.Event["error"] = map[string]any{
				"message": err.Error(),
				"source":  "database",
			}
		}
	}

	_, dbErr := h.db.NamedExec("UPDATE private_location SET last_seen_at = :last_seen_at WHERE id = :id", map[string]any{
		"last_seen_at": time.Now().Unix(),
		"id":           regionID,
	})
	if dbErr != nil {
		if holder := GetEvent(ctx); holder != nil {
			holder.Event["db_update_error"] = map[string]any{
				"message": dbErr.Error(),
				"type":    "last_seen_update",
			}
		}
	}

	// Trigger alerting asynchronously (fire-and-forget)
	go triggerAlerting(data, regionID)
}

// triggerAlerting calls the main server's internal alerting endpoint
// to process status changes and send notifications.
func triggerAlerting(data any, regionID int) {
	serverURL := os.Getenv("SERVER_URL")
	if serverURL == "" {
		serverURL = "http://localhost:3000"
	}

	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return
	}

	var fields map[string]any
	if err := json.Unmarshal(jsonBytes, &fields); err != nil {
		return
	}

	payload := map[string]any{
		"monitorId":   fields["monitorId"],
		"workspaceId": fields["workspaceId"],
		"region":      fmt.Sprintf("%d", regionID),
		"newStatus":   fields["requestStatus"],
		"statusCode":  fields["statusCode"],
		"message":     fields["errorMessage"],
		"latency":     fields["latency"],
		"cronTimestamp": fields["cronTimestamp"],
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(
		serverURL+"/internal/alerting/process",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return
	}
	resp.Body.Close()
}
