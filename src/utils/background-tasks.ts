/**
 * Background Task Manager
 *
 * Manages background execution of long-running tasks
 */

export interface BackgroundTask {
  id: string;
  type: string;
  promise: Promise<any>;
  startTime: number;
  status: 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private maxTasks = 100; // Prevent memory leaks

  /**
   * Register a background task
   */
  register(id: string, type: string, promise: Promise<any>): string {
    // Clean up old tasks if we have too many
    if (this.tasks.size >= this.maxTasks) {
      this.cleanup();
    }

    const task: BackgroundTask = {
      id,
      type,
      promise,
      startTime: Date.now(),
      status: 'running',
    };

    this.tasks.set(id, task);

    // Handle task completion
    promise
      .then((result) => {
        task.status = 'completed';
        task.result = result;
      })
      .catch((error) => {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : 'Unknown error';
      });

    return id;
  }

  /**
   * Get task status
   */
  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * List all tasks
   */
  list(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Clean up completed tasks older than 1 hour
   */
  cleanup(): void {
    const oneHourAgo = Date.now() - 3600000;
    for (const [id, task] of this.tasks.entries()) {
      if (task.status !== 'running' && task.startTime < oneHourAgo) {
        this.tasks.delete(id);
      }
    }
  }

  /**
   * Get running task count
   */
  runningCount(): number {
    return Array.from(this.tasks.values()).filter(t => t.status === 'running').length;
  }
}

// Singleton instance
export const backgroundTaskManager = new BackgroundTaskManager();
