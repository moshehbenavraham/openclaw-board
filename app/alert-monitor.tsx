"use client";

import { useEffect, useState } from "react";

// Background alert checker that starts automatically with the app.
export function AlertMonitor() {
  const [enabled, setEnabled] = useState(false);
  const [checkInterval, setCheckInterval] = useState(10);
  const [lastResults, setLastResults] = useState<string[]>([]);

  useEffect(() => {
    // Load config and start checking.
    fetch("/api/alerts")
      .then(r => r.json())
      .then(config => {
        if (config.enabled) {
          setEnabled(true);
          // Alert check function.
          const checkAlerts = () => {
            fetch("/api/alerts/check", { method: "POST" })
              .then(r => r.json())
              .then(data => {
                if (data.results && data.results.length > 0) {
                  setLastResults(data.results);
                  console.log("[AlertMonitor] Alerts triggered:", data.results);
                }
              })
              .catch(console.error);
          };
          
          // Run one immediate check.
          checkAlerts();
          
          // Start the interval timer.
          const timer = setInterval(checkAlerts, (config.checkInterval || 10) * 60 * 1000);
          return () => clearInterval(timer);
        }
      })
      .catch(console.error);
  }, []);

  // Render nothing; this runs only in the background.
  return null;
}
