// =====================================================
// CO Levels Database & Pathfinding Module
// =====================================================

/**
 * Simulated database of CO levels at different locations
 * In production, this would fetch from a real API/database
 */
class CODatabase {
  constructor() {
    // Grid size for the building map
    this.gridWidth = 10;
    this.gridHeight = 10;
    
    // Location data with CO readings
    // Each cell represents a zone in the building
    this.locations = this.generateLocations();
    
    // Simulated sensors sending data
    this.sensors = [];
    this.updateInterval = null;
  }

  /**
   * Generate initial location data with CO levels
   */
  generateLocations() {
    const locations = [];
    const zoneNames = [
      'Lobby', 'Hallway A', 'Hallway B', 'Office 1', 'Office 2',
      'Kitchen', 'Storage', 'Meeting Room', 'Server Room', 'Exit'
    ];

    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const id = y * this.gridWidth + x;
        locations.push({
          id: id,
          x: x,
          y: y,
          name: `Zone ${id}`,
          coLevel: Math.random() * 15, // Initial CO level (0-15 ppm normal)
          isWall: this.isWallPosition(x, y),
          isExit: this.isExitPosition(x, y),
          isStart: x === 0 && y === 0,
          lastUpdated: new Date(),
          sensorId: `SENSOR-${id.toString().padStart(3, '0')}`
        });
      }
    }
    return locations;
  }

  /**
   * Define wall positions for the building layout
   */
  isWallPosition(x, y) {
    // Create some walls for a realistic building layout
    const walls = [
      // Vertical wall with gap
      { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 3, y: 4 },
      // Horizontal wall with gap
      { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 },
      // Another section
      { x: 6, y: 2 }, { x: 6, y: 3 }, { x: 6, y: 4 },
      { x: 7, y: 7 }, { x: 8, y: 7 }
    ];
    return walls.some(w => w.x === x && w.y === y);
  }

  /**
   * Define exit positions
   */
  isExitPosition(x, y) {
    return (x === 9 && y === 9) || (x === 9 && y === 0) || (x === 0 && y === 9);
  }

  /**
   * Get location by coordinates
   */
  getLocation(x, y) {
    if (x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight) {
      return null;
    }
    return this.locations[y * this.gridWidth + x];
  }

  /**
   * Get all locations
   */
  getAllLocations() {
    return this.locations;
  }

  /**
   * Get locations sorted by CO level
   */
  getLocationsByCOLevel(ascending = true) {
    return [...this.locations]
      .filter(l => !l.isWall)
      .sort((a, b) => ascending ? a.coLevel - b.coLevel : b.coLevel - a.coLevel);
  }

  /**
   * Get dangerous zones (CO > threshold)
   */
  getDangerousZones(threshold = 25) {
    return this.locations.filter(l => l.coLevel >= threshold && !l.isWall);
  }

  /**
   * Update CO level for a location (simulates sensor data)
   */
  updateCOLevel(x, y, coLevel) {
    const location = this.getLocation(x, y);
    if (location) {
      location.coLevel = coLevel;
      location.lastUpdated = new Date();
      return true;
    }
    return false;
  }

  /**
   * Simulate CO spread from a source
   */
  simulateCOSpread(sourceX, sourceY, intensity = 50) {
    const source = this.getLocation(sourceX, sourceY);
    if (!source) return;

    source.coLevel = intensity;

    // Spread to neighbors with decay
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx === 0 && dy === 0) continue;
        const neighbor = this.getLocation(sourceX + dx, sourceY + dy);
        if (neighbor && !neighbor.isWall) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          const spreadCO = intensity * Math.exp(-distance * 0.5);
          neighbor.coLevel = Math.max(neighbor.coLevel, spreadCO);
        }
      }
    }
  }

  /**
   * Start real-time updates (simulation)
   */
  startRealTimeUpdates(callback) {
    this.updateInterval = setInterval(() => {
      // Randomly update some CO levels
      const numUpdates = Math.floor(Math.random() * 5) + 1;
      for (let i = 0; i < numUpdates; i++) {
        const x = Math.floor(Math.random() * this.gridWidth);
        const y = Math.floor(Math.random() * this.gridHeight);
        const location = this.getLocation(x, y);
        if (location && !location.isWall) {
          // Small random fluctuation
          const change = (Math.random() - 0.5) * 5;
          location.coLevel = Math.max(0, Math.min(100, location.coLevel + change));
          location.lastUpdated = new Date();
        }
      }
      if (callback) callback(this.locations);
    }, 2000);
  }

  /**
   * Stop real-time updates
   */
  stopRealTimeUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Fetch data from remote API (placeholder for real implementation)
   */
  async fetchFromAPI() {
    // TODO: Replace with actual API call
    // Example:
    // const response = await fetch('https://api.codetect.com/sensors');
    // const data = await response.json();
    // this.locations = data.locations;
    
    return this.locations;
  }
}

/**
 * A* Pathfinding Algorithm with CO-aware cost function
 */
class PathFinder {
  constructor(database) {
    this.db = database;
  }

  /**
   * Calculate movement cost considering CO level
   * Higher CO = higher cost = less likely to be chosen
   */
  calculateCost(location) {
    if (location.isWall) return Infinity;
    
    // Base cost of 1 for movement
    let cost = 1;
    
    // CO level penalty (exponential to heavily penalize dangerous areas)
    const coLevel = location.coLevel;
    if (coLevel > 50) {
      cost += 1000; // Extremely dangerous
    } else if (coLevel > 35) {
      cost += 100; // Very dangerous
    } else if (coLevel > 25) {
      cost += 20; // Dangerous
    } else if (coLevel > 15) {
      cost += 5; // Elevated
    } else {
      cost += coLevel * 0.1; // Normal range
    }
    
    return cost;
  }

  /**
   * Heuristic function (Manhattan distance)
   */
  heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * Get valid neighbors of a cell
   */
  getNeighbors(location) {
    const neighbors = [];
    const directions = [
      { dx: 0, dy: -1 }, // Up
      { dx: 0, dy: 1 },  // Down
      { dx: -1, dy: 0 }, // Left
      { dx: 1, dy: 0 },  // Right
      // Diagonal movement (optional)
      { dx: -1, dy: -1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: 1, dy: 1 }
    ];

    for (const dir of directions) {
      const neighbor = this.db.getLocation(location.x + dir.dx, location.y + dir.dy);
      if (neighbor && !neighbor.isWall) {
        neighbors.push(neighbor);
      }
    }

    return neighbors;
  }

  /**
   * A* Pathfinding Algorithm
   * Returns the safest path from start to goal
   */
  findPath(startX, startY, goalX, goalY) {
    const start = this.db.getLocation(startX, startY);
    const goal = this.db.getLocation(goalX, goalY);

    if (!start || !goal || start.isWall || goal.isWall) {
      return { path: [], success: false, message: 'Invalid start or goal' };
    }

    // Priority queue (using array with sorting for simplicity)
    const openSet = [start];
    const closedSet = new Set();
    
    // Track path
    const cameFrom = new Map();
    
    // Cost maps
    const gScore = new Map(); // Cost from start to node
    const fScore = new Map(); // gScore + heuristic
    
    gScore.set(start.id, 0);
    fScore.set(start.id, this.heuristic(start, goal));

    while (openSet.length > 0) {
      // Get node with lowest fScore
      openSet.sort((a, b) => (fScore.get(a.id) || Infinity) - (fScore.get(b.id) || Infinity));
      const current = openSet.shift();

      // Reached goal
      if (current.id === goal.id) {
        return this.reconstructPath(cameFrom, current);
      }

      closedSet.add(current.id);

      // Check neighbors
      for (const neighbor of this.getNeighbors(current)) {
        if (closedSet.has(neighbor.id)) continue;

        const tentativeGScore = (gScore.get(current.id) || Infinity) + this.calculateCost(neighbor);

        if (!openSet.find(n => n.id === neighbor.id)) {
          openSet.push(neighbor);
        } else if (tentativeGScore >= (gScore.get(neighbor.id) || Infinity)) {
          continue;
        }

        cameFrom.set(neighbor.id, current);
        gScore.set(neighbor.id, tentativeGScore);
        fScore.set(neighbor.id, tentativeGScore + this.heuristic(neighbor, goal));
      }
    }

    return { path: [], success: false, message: 'No path found' };
  }

  /**
   * Reconstruct path from A* result
   */
  reconstructPath(cameFrom, current) {
    const path = [current];
    let totalCO = current.coLevel;
    let maxCO = current.coLevel;

    while (cameFrom.has(current.id)) {
      current = cameFrom.get(current.id);
      path.unshift(current);
      totalCO += current.coLevel;
      maxCO = Math.max(maxCO, current.coLevel);
    }

    return {
      path: path,
      success: true,
      stats: {
        length: path.length,
        averageCO: (totalCO / path.length).toFixed(1),
        maxCO: maxCO.toFixed(1),
        estimatedTime: `${path.length * 3} seconds` // Assuming 3 seconds per zone
      }
    };
  }

  /**
   * Find path to nearest exit
   */
  findNearestExit(startX, startY) {
    const exits = this.db.getAllLocations().filter(l => l.isExit);
    let bestPath = null;
    let bestScore = Infinity;

    for (const exit of exits) {
      const result = this.findPath(startX, startY, exit.x, exit.y);
      if (result.success) {
        // Score based on path length and average CO
        const score = result.path.length + parseFloat(result.stats.averageCO);
        if (score < bestScore) {
          bestScore = score;
          bestPath = result;
          bestPath.exitLocation = exit;
        }
      }
    }

    return bestPath || { path: [], success: false, message: 'No exit reachable' };
  }

  /**
   * Find multiple alternative paths
   */
  findAlternativePaths(startX, startY, goalX, goalY, numPaths = 3) {
    const paths = [];
    const exits = this.db.getAllLocations().filter(l => l.isExit);

    for (const exit of exits) {
      const result = this.findPath(startX, startY, exit.x, exit.y);
      if (result.success) {
        result.exitName = `Exit at (${exit.x}, ${exit.y})`;
        paths.push(result);
      }
    }

    // Sort by safety (average CO) and return top paths
    paths.sort((a, b) => parseFloat(a.stats.averageCO) - parseFloat(b.stats.averageCO));
    return paths.slice(0, numPaths);
  }
}

// Export for use in main.js
export { CODatabase, PathFinder };
