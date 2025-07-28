package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

// Log represents the structure for a log entry in the database.
type Log struct {
	ID        int       `json:"id"`
	Level     string    `json:"level"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateLogRequest defines the structure for the JSON payload when creating a log.
type CreateLogRequest struct {
	Level   string `json:"level" binding:"required"`
	Message string `json:"message"`
}

// UpdateLogRequest defines the structure for the JSON payload when updating a log.
type UpdateLogRequest struct {
	Level   string `json:"level" binding:"required"`
	Message string `json:"message"`
}

// Server holds the database connection.
type Server struct {
	db *sql.DB
}

func main() {
	// Construct the database connection string from environment variables
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		getEnv("DB_HOST", "localhost"),
		getEnv("DB_PORT", "5432"),
		getEnv("DB_USER", "postgres"),
		getEnv("DB_PASSWORD", "postgres"),
		getEnv("DB_NAME", "erp_system"),
	)

	var db *sql.DB
	var err error

	// Retry connecting to the database to handle startup delays between services.
	maxRetries := 10
	for i := 0; i < maxRetries; i++ {
		db, err = sql.Open("postgres", dsn)
		if err == nil {
			err = db.Ping()
			if err == nil {
				log.Println("Successfully connected to the database.")
				break
			}
		}
		log.Printf("Database connection failed (attempt %d/%d): %v. Retrying in 5 seconds...", i+1, maxRetries, err)
		time.Sleep(5 * time.Second)
	}

	if err != nil {
		log.Fatal("Could not connect to the database after several retries:", err)
	}
	defer db.Close()

	server := &Server{db: db}

	// Run database migration to ensure the 'logs' table exists.
	if err := server.migrateDB(); err != nil {
		log.Fatal("Database migration failed:", err)
	}

	// Setup Gin routes
	r := gin.Default()

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": "log-viewer-service",
			"time":    time.Now().UTC(),
		})
	})

	// Group API routes under /api/v1
	api := r.Group("/api/v1")
	{
		api.GET("/logs", server.getLogs)
		api.POST("/logs", server.createLog)
		api.GET("/logs/:id", server.getLog)
		api.PUT("/logs/:id", server.updateLog)
		api.DELETE("/logs/:id", server.deleteLog)
	}

	port := getEnv("PORT", "8001")
	log.Printf("Starting log-viewer service on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal("Failed to run server:", err)
	}
}

// migrateDB creates the necessary database tables if they don't already exist.
func (s *Server) migrateDB() error {
	query := `
    CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        level VARCHAR(50) NOT NULL,
        message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`

	_, err := s.db.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create logs table: %w", err)
	}

	log.Println("Database migration completed successfully.")
	return nil
}

// getLogs retrieves all log entries from the database.
func (s *Server) getLogs(c *gin.Context) {
	rows, err := s.db.Query("SELECT id, level, message, created_at FROM logs ORDER BY created_at DESC")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query logs: " + err.Error()})
		return
	}
	defer rows.Close()

	var logs []Log
	for rows.Next() {
		var logEntry Log
		if err := rows.Scan(&logEntry.ID, &logEntry.Level, &logEntry.Message, &logEntry.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan log entry: " + err.Error()})
			return
		}
		logs = append(logs, logEntry)
	}

	c.JSON(http.StatusOK, logs)
}

// createLog adds a new log entry to the database.
func (s *Server) createLog(c *gin.Context) {
	var req CreateLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	var newLog Log
	err := s.db.QueryRow(
		"INSERT INTO logs (level, message) VALUES ($1, $2) RETURNING id, created_at, level, message",
		req.Level, req.Message,
	).Scan(&newLog.ID, &newLog.CreatedAt, &newLog.Level, &newLog.Message)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create log: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, newLog)
}

// getLog retrieves a single log entry by its ID.
func (s *Server) getLog(c *gin.Context) {
	id := c.Param("id")
	var logEntry Log

	err := s.db.QueryRow("SELECT id, level, message, created_at FROM logs WHERE id = $1", id).Scan(&logEntry.ID, &logEntry.Level, &logEntry.Message, &logEntry.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Log not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get log: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, logEntry)
}

// updateLog updates an existing log entry.
func (s *Server) updateLog(c *gin.Context) {
	id := c.Param("id")
	var req UpdateLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	result, err := s.db.Exec(
		"UPDATE logs SET level = $1, message = $2 WHERE id = $3",
		req.Level, req.Message, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update log: " + err.Error()})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Log not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Log updated successfully"})
}

// deleteLog removes a log entry from the database.
func (s *Server) deleteLog(c *gin.Context) {
	id := c.Param("id")
	result, err := s.db.Exec("DELETE FROM logs WHERE id = $1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete log: " + err.Error()})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Log not found"})
		return
	}

	c.Status(http.StatusNoContent)
}

// getEnv is a helper function to read an environment variable or return a default value.
func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
