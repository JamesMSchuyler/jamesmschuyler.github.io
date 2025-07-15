//Player is black.  

//Eliminate enemies by surrounding on three sides.
const PLAYER_TEAM = 1;
const ENEMY_TEAM = 2;
const hexSize = 25;
let DIFFICULTY = -1; // Initialized at -1, +1 per level. 0=9/9 dice, 1=9/10, 2=8/10, etc.
const r = hexSize; // "radius"
const animationLoopSize = 53;
let boardScale; // This will now be calculated dynamically to be responsive

const LEVEL_NAMES = [
    "Block", "Village", "Town", "City", "Country", "Province", "Region",
    "Nation", "Subcontinent", "Continent", "World", "System", "Star Cluster",
    "Galaxy", "Galaxy Cluster", "Universe", "Multiverse"
];

const DIFFICULTY_LABELS = {
    "-5": "Super Easy",
    "-4": "Very Easy",
    "-3": "Easy",
    "-2": "Kind of Easy",
    "-1": "A Little Easier",
    "0": "Normal",
    "1": "A Little Harder",
    "2": "Getting Hard",
    "3": "Hard",
    "4": "Very Hard",
    "5": "Super Hard",
    "6": "Crazy Hard",
    "7": "Ridiculously Hard",
    "8": "Kind of Impossible",
    "9": "Impossible",
    "10": "Very Impossible"
};

const AI_SCORING_WEIGHTS = {
    RANDOM_TIEBREAK: 45,
    CAVALRY_LONG_MOVE: 10,
    // Score for creating a standard 3-on-1 tactical surround on an enemy unit.
    CREATE_KILL: 100,
    KILL_ARCHER_BONUS: 200,
    KILL_CANNON_BONUS: 125,
    KILL_CAVALRY_BONUS: 75,
    SETUP_KILL: 20,
    DANGEROUS_MOVE: -50,
    // Score per unit eliminated via the special 5-unit zone capture rule.
    // This is separate from CREATE_KILL as it's a different game mechanic.
    CAPTURE_ZONE_PER_UNIT: 100,
    VULNERABLE_ZONE: -150
};

/**
 * Defines the rules for promoting a standard soldier to a special unit type
 * when a zone is captured at the end of a level. The rules are ordered by priority,
 * with the strongest or most specific units appearing first.
 */
const SPECIAL_UNIT_PROMOTION_RULES = [
    // Rules should be ordered by priority (strongest unit first)
    { unitType: 2, advantage: 6, minLevel: 3 }, // Archer
    { unitType: 4, advantage: 4, minLevel: 5 }, // Cannon
    // Cavalry has a special check: it can be created on level 2, OR any level if the player has been to level 2 before.
    { unitType: 3, advantage: 3, minLevel: 2, specialLevelCheck: () => gameState.hasBeenOnLevel2 } // Cavalry
];

// Layout for the 7 dots in a hexagonal cluster for the "Moves Left" UI.
// Defined globally with normalized coordinates (0 to 1) as it's a constant
// and doesn't need to be recreated every frame.
const UI_DOT_LAYOUT = [
    { zone: 1, x: 0, y: -1 },                     // Top
    { zone: 2, x: 0.866, y: -0.5 }, // Top-right
    { zone: 3, x: 0.866, y: 0.5 },  // Bottom-right
    { zone: 4, x: 0, y: 1 },                      // Bottom
    { zone: 5, x: -0.866, y: 0.5 }, // Bottom-left
    { zone: 6, x: -0.866, y: -0.5 },// Top-left
    { zone: 7, x: 0, y: 0 }                             // Center
];

let sounds = {}; // Object to hold our loaded sound files
let uiLayout = {}; // Object to hold pre-calculated UI layout values
let hexesByZone = new Map(); // Cache for quick lookups of hexes by zone
let hexRangeCache = new Map(); // Cache for pre-calculated hex ranges to improve performance
let hexCoordMap = new Map(); // Cache for mapping "x,y" coordinates to a hex index
let hexagon = [];
let gameState = {
    selected: -1, // -1 means not selected, 0-48 is selected hex number    
    badClick: 0,
    zonesMovedFromThisTurn: new Set(),
    endTurn: 0,
    isPlayerTurn: true,
    aiMoveQueue: [],    
    aiZonesMovedFromThisTurn: new Set(), // AI's used moves for the turn
    aiMovesMadeThisTurn: 0, // Number of moves AI has made in its current turn
    introScreenDifficulty: 0, // Difficulty setting for the intro screen
    validMoves: new Set(), // The set of valid destination hex indices for the selected unit
    currentScreen: 'intro', // 'intro', 'instructions', 'game'
    animationLoop: 0,
    animateMovementFrom: null,
    animateMovementTo: null,
    levelMemory: new Map(), // Stores the state of outer zones for higher levels
    level: 0, // Keep track of the current level
    gameWon: false, // True when player wins the final level
    winRotation: 0, // For the final win screen animation
    hasBeenOnLevel5: false, // Tracks if the player has ever been on level 5, for the cannon intro
    hasBeenOnLevel3: false, // Tracks if the player has ever been on level 3, for the archer intro
    hasBeenOnLevel2: false, // Tracks if the player has ever been on level 2, for the cavalry intro
    playerTurnCount: 0, // How many turns the player has taken on this level
    scoutMessageShownOnLevels: new Set(), // Tracks levels where the scout message has been shown.
    secretArcherZone: null, // The zone hinted at in the scout message
    potentialCannonTargets: [], // Array of hex indices in the cannon's firing ring
    highlightedCannonTargetGroup: null, // The currently hovered target group
    lastAimingHexIndex: null, // The aiming hex used for the last highlighted group
    cannonIsAiming: false, // True when the cannon has a "locked" target preview
    lockedAimingHexIndex: null, // The aiming hex index used to create the locked-in target
    animateCannonThreat: null, // Stores data for the AI cannon targeting animation
    cannonThreats: new Map(), // Maps cannon index -> { threatenedHexes, relativeAim }
    cannonsFiredThisTurn: new Set(), // Tracks which cannons have fired this turn
    selectedZone: null, // The currently selected zone number (1-7)
    zoneSelectionMode: false, // Is the player currently in the mode to select a zone?
};

// Mapping from input zone number to the corresponding hex index in Zone 7
const ZONE_TO_ZONE_7_HEX_MAP = {
    1: 17, // Zone 1 -> Hex 17
    2: 25, // Zone 2 -> Hex 25
    3: 32, // Zone 3 -> Hex 32
    4: 31, // Zone 4 -> Hex 31
    5: 23, // Zone 5 -> Hex 23
    6: 16, // Zone 6 -> Hex 16
    7: 24  // Zone 7 -> Hex 24
};
const ZONE_7_HEX_INDICES = Object.values(ZONE_TO_ZONE_7_HEX_MAP);

//converts x, y-ish hex coordinates to actual x, y position
function hexToXY(xHexA, yHexA)   {
    // The board's geometry is calculated within a fixed 400x400 area.
    // We subtract 200 (half of 400) to get coordinates relative to the board's own center.
    // This offset is then used in the main draw loop, which is translated to the screen's center.
    const boardCenter = 200;
    return  {
        x : (xHexA * 44 + 85 - yHexA * 21) - boardCenter,
        y : (yHexA * 38 + 10) - boardCenter
    };
};

function clickIsInCircle(xHexB, yHexB)  {
    // The main draw loop is translated to the center of the screen.
    // We must adjust the global mouse coordinates to be in that same coordinate space,
    // and we must also account for the board being scaled up.
    const translatedMouseX = mouseX - (width / 2);
    const translatedMouseY = mouseY - (height / 2);

    const scaledMouseX = translatedMouseX / boardScale;
    const scaledMouseY = translatedMouseY / boardScale;

    const hexPos = hexToXY(xHexB, yHexB); // hexToXY returns the hex's position relative to the center.

    return  (scaledMouseX - hexPos.x) * (scaledMouseX - hexPos.x) +
            (scaledMouseY - hexPos.y) * (scaledMouseY - hexPos.y) <
            (r * 13 / 16) * (r * 13 / 16);
}

let zoneColor = [];

class Button {
    constructor(x, y, radius, label, secondLabel, arrowStyle = 'none') {
        this.x = x; // Absolute canvas coordinates
        this.y = y; // Absolute canvas coordinates
        this.radius = radius;
        this.label = label;
        this.secondLabel = secondLabel;
        this.arrowStyle = arrowStyle;
    }

    draw(isActive = true, isToggled = false) {
        // The main draw loop is translated to the center of the screen.
        // We must subtract the center coordinates to draw the button at its absolute position.
        const drawX = this.x - (width / 2);
        const drawY = this.y - (height / 2);
        const buttonCircleRadius = this.radius * 13 / 16;

        // Determine colors for a more noticeable dimmed state
        const buttonColor = isActive ? color(242, 72, 72) : color(120, 120, 120); // Darker gray
        const textColor = isActive ? color(8, 8, 8) : color(160, 160, 160); // Lighter, more faded text
        const arrowColor = isActive ? color(0) : color(160, 160, 160); // Match faded text

        // --- Draw Button Body ---
        fill(buttonColor);
        if (isToggled) {
            // Draw a highlight for toggled state
            stroke(255, 255, 0); // Yellow
            strokeWeight(3);
        } else if (this.arrowStyle === 'none') {
            stroke(0);
            strokeWeight(isActive ? 2 : 1);
        } else {
            noStroke();
        }
        ellipse(drawX, drawY, buttonCircleRadius * 2, buttonCircleRadius * 2);

        // --- Draw Arrows (if applicable) ---
        if (this.arrowStyle !== 'none') {
            stroke(arrowColor);
            strokeWeight(2); // Match button border thickness
            noFill(); // Arrows are lines, not filled shapes

            const outerOffset = this.radius * 0.075; // Reduced distance from button edge to arrow start
            const shaftLength = this.radius * 0.25;
            const headLength = this.radius * 0.2;
            const headAngle = PI / 6; // 30 degrees

            for (let i = 0; i < 8; i++) {
                const angle = i * PI / 4;
                push();
                translate(drawX, drawY);
                rotate(angle);

                if (this.arrowStyle === 'out') {
                    // Arrow points away from center (upwards in this rotated context)
                    const shaftBaseY = -(buttonCircleRadius + outerOffset);
                    const shaftTipY = shaftBaseY - shaftLength;

                    line(0, shaftBaseY, 0, shaftTipY); // Shaft
                    line(0, shaftTipY, -headLength * sin(headAngle), shaftTipY + headLength * cos(headAngle)); // Left head (angled correctly)
                    line(0, shaftTipY, headLength * sin(headAngle), shaftTipY + headLength * cos(headAngle)); // Right head (angled correctly)
                } else { // 'in'
                    // Arrow points towards center (downwards in this rotated context)
                    const shaftBaseY = -(buttonCircleRadius + outerOffset + shaftLength); // Base of shaft
                    const shaftTipY = shaftBaseY + shaftLength; // Tip of shaft

                    line(0, shaftBaseY, 0, shaftTipY); // Shaft
                    line(0, shaftTipY, -headLength * sin(headAngle), shaftTipY - headLength * cos(headAngle)); // Left head (angled correctly)
                    line(0, shaftTipY, headLength * sin(headAngle), shaftTipY - headLength * cos(headAngle)); // Right head (angled correctly)
                }
                pop();
            }
        }

        // --- Draw Text ---
        fill(textColor); // Use determined text color
        noStroke();
        const baseRadius = 36; // The original radius the text was designed for        
        textAlign(CENTER, CENTER);
        if (this.secondLabel) {
            textSize(this.radius * (19 / baseRadius));
            text(this.label, drawX, drawY - (this.radius * (5 / baseRadius)));
            textSize(this.radius * (13 / baseRadius));
            text(this.secondLabel, drawX, drawY + (this.radius * (12 / baseRadius)));
        } else {
            // If there's no second label, draw the first one centered vertically.
            textSize(this.radius * (14 / baseRadius)); // Use a smaller size for long single-line text
            text(this.label, drawX, drawY);
        }
        textAlign(LEFT, BASELINE); // Reset alignment
    }

    pressed() {
        // Check distance against absolute mouse coordinates
        return dist(mouseX, mouseY, this.x, this.y) < (this.radius * 13 / 16);
    }
}

let endTurnButton; // Will be initialized in setup()
let zoomOutButton; // New button for testing win screen
let newGameButton; // Button on the intro screen
let startButton; // Button on the instructions screen
let upArrowButton; // Button for increasing difficulty on the intro screen
let downArrowButton; // Button for decreasing difficulty on the intro screen
let debugSkipLevelButton; // DEBUG: Button to skip to a specific level for testing.

/**
 * Pre-calculates and caches the hexes within a certain range for every hex on the board.
 * This is a one-time operation at startup to significantly speed up functions
 * like isSurrounded and the AI's move evaluation, which repeatedly need this data.
 */
function precalculateHexRanges() {
    const maxRange = 2; // The maximum range our game logic currently needs.
    for (let i = 0; i < hexagon.length; i++) {
        const rangesForHex = new Map();
        for (let r = 1; r <= maxRange; r++) {
            // This uses the original BFS logic to calculate the result once.
            const visited = new Set();
            const queue = [{ index: i, dist: 0 }];
            const hexesInRange = new Set();
            visited.add(i);
            while (queue.length > 0) {
                const { index, dist } = queue.shift();
                if (dist > 0 && dist <= r) {
                    hexesInRange.add(index);
                }
                if (dist < r) {
                    for (const adjIndex of hexagon[index].adjacencies) {
                        if (!visited.has(adjIndex)) {
                            visited.add(adjIndex);
                            queue.push({ index: adjIndex, dist: dist + 1 });
                        }
                    }
                }
            }
            rangesForHex.set(r, Array.from(hexesInRange));
        }
        hexRangeCache.set(i, rangesForHex);
    }
    console.log("Hex ranges pre-calculated and cached.");
}

/**
 * Pre-calculates and caches a map from hex coordinates to their index in the hexagon array.
 * This is a one-time operation at startup to significantly speed up coordinate-based lookups,
 * such as when moving a cannon's threat area.
 */
function precalculateCoordMap() {
    for (let i = 0; i < hexagon.length; i++) {
        const key = `${hexagon[i].xHex},${hexagon[i].yHex}`;
        hexCoordMap.set(key, i);
    }
    console.log("Hex coordinate map pre-calculated and cached.");
}

function getHexesInRange(startIndex, range) {
    // First, try to retrieve the pre-calculated result from the cache.
    if (hexRangeCache.has(startIndex) && hexRangeCache.get(startIndex).has(range)) {
        return hexRangeCache.get(startIndex).get(range);
    }

    // Fallback to on-the-fly calculation if the result wasn't cached.
    // This is a safety net and shouldn't be hit for ranges 1 and 2 after setup.
    console.warn(`Cache miss for getHexesInRange(startIndex: ${startIndex}, range: ${range}). Calculating on the fly.`);
    const visited = new Set();
    const queue = [{ index: startIndex, dist: 0 }];
    const hexesInRange = new Set();

    visited.add(startIndex);

    while (queue.length > 0) {
        const { index, dist } = queue.shift();

        if (dist > 0 && dist <= range) { // Don't include the start hex itself
            hexesInRange.add(index);
        }

        if (dist < range) {
            for (const adjIndex of hexagon[index].adjacencies) {
                if (!visited.has(adjIndex)) {
                    visited.add(adjIndex);
                    queue.push({ index: adjIndex, dist: dist + 1 });
                }
            }
        }
    }
    return Array.from(hexesInRange);
}

class Hexagon {
    constructor(xHex, yHex, zone, adjacencies, mapsToNewZone = null) {
        this.xHex = xHex;
        this.yHex = yHex;
        this.zone = zone;
        this.adjacencies = adjacencies;
        this.mapsToNewZone = mapsToNewZone; // The new zone this hex becomes when its zone is zoomed into
        this.unit = 0;
        this.team = 0;
    }

    draw(index, overrideColor = null) {
        // 1. Determine fill and stroke colors based on game state.
        let fillColor = overrideColor || zoneColor[this.zone];
        let strokeColor = color(0); // Default black
        let sw = r / 18; // Default stroke weight

        // Highlight for selected zone (lower priority)
        if (zoomInAnimationState.phase === 'inactive' && gameState.selectedZone === this.zone) {
            strokeColor = color(255, 255, 0); // Yellow outline for selected zone
            sw = 3;
            // Darken the fill color to "shade" the selected zone.
            fillColor = lerpColor(fillColor, color(0), 0.3);
        }

        if (zoomOutAnimationState.phase === 'inactive' && gameState.selected !== -1 && gameState.validMoves.has(index)) {
            strokeColor = color(0, 106, 255); // Lighter blue for valid move
            sw = 4;
            fillColor = color(129, 133, 129); // Greenish fill for valid move
        } else if (zoomOutAnimationState.phase === 'inactive' && gameState.selected === index) {
            strokeColor = color(4, 0, 255); // Blue outline for selected
            sw = 4;
            fillColor = color(105, 101, 101); // Grey fill for selected
        }

        // 2. Apply styles and draw the hexagon shape.
        stroke(strokeColor);
        strokeWeight(sw);
        fill(fillColor);

        const pos = hexToXY(this.xHex, this.yHex);
        beginShape();
        vertex(pos.x, pos.y - r);
        vertex(pos.x + r * sqrt(3) / 2, pos.y - r / 2);
        vertex(pos.x + r * sqrt(3) / 2, pos.y + r / 2);
        vertex(pos.x, pos.y + r);
        vertex(pos.x - r * sqrt(3) / 2, pos.y + r / 2);
        vertex(pos.x - r * sqrt(3) / 2, pos.y - r / 2);
        endShape(CLOSE);
    }

    showCoordinates(index) {
        const pos = hexToXY(this.xHex, this.yHex);
        fill(0);
        noStroke();
        textAlign(CENTER, CENTER);
        textSize(12);
        text(index, pos.x, pos.y);
        textAlign(LEFT, BASELINE); // Reset alignment
    }
}





                                    // mapsToNewZone
hexagon[0] = new Hexagon(3, 1, 1, [1, 4, 5], 6);
hexagon[1] = new Hexagon(4, 1, 1, [0, 5, 6], 1);
hexagon[2] = new Hexagon(1, 2, 6, [3, 7, 8], 6);
hexagon[3] = new Hexagon(2, 2, 6, [2, 4, 8, 9], 1);
hexagon[4] = new Hexagon(3, 2, 1, [0, 3, 5, 9, 10], 5);
hexagon[5] = new Hexagon(4, 2, 1, [0, 1, 4, 6, 10, 11], 7);
hexagon[6] = new Hexagon(5, 2, 1, [1, 5, 11, 12], 2);
hexagon[7] = new Hexagon(1, 3, 6, [2, 8, 14], 5);
hexagon[8] = new Hexagon(2, 3, 6, [2, 3, 7, 9, 14, 15], 7);
hexagon[9] = new Hexagon(3, 3, 6, [3, 4, 8, 10, 15, 16], 2);
hexagon[10] = new Hexagon(4, 3, 1, [4, 5, 9, 11, 16, 17], 4);
hexagon[11] = new Hexagon(5, 3, 1, [5, 6, 10, 12, 17, 18], 3);
hexagon[12] = new Hexagon(6, 3, 2, [6, 11, 13, 18, 19], 6);
hexagon[13] = new Hexagon(7, 3, 2, [12, 19, 20], 1);
hexagon[14] = new Hexagon(2, 4, 6, [7, 8, 15, 21, 22], 4);
hexagon[15] = new Hexagon(3, 4, 6, [8, 9, 14, 16, 22, 23], 3);
hexagon[16] = new Hexagon(4, 4, 7, [9, 10, 15, 17, 23, 24], 6);
hexagon[17] = new Hexagon(5, 4, 7, [10, 11, 16, 18, 24, 25], 1);
hexagon[18] = new Hexagon(6, 4, 2, [11, 12, 17, 19, 25, 26], 5);
hexagon[19] = new Hexagon(7, 4, 2, [12, 13, 18, 20, 26, 27], 7);
hexagon[20] = new Hexagon(8, 4, 2, [13, 19, 27], 2);
hexagon[21] = new Hexagon(2, 5, 5, [14, 22, 28, 29], 6);
hexagon[22] = new Hexagon(3, 5, 5, [14, 15, 21, 23, 29, 30], 1);
hexagon[23] = new Hexagon(4, 5, 7, [15, 16, 22, 24, 30, 31], 5);
hexagon[24] = new Hexagon(5, 5, 7, [16, 17, 23, 25, 31, 32], 7);
hexagon[25] = new Hexagon(6, 5, 7, [17, 18, 24, 26, 32, 33], 2);
hexagon[26] = new Hexagon(7, 5, 2, [18, 19, 25, 27, 33, 34], 4);
hexagon[27] = new Hexagon(8, 5, 2, [19, 20, 26, 34], 3);
hexagon[28] = new Hexagon(2, 6, 5, [21, 29, 35], 5);
hexagon[29] = new Hexagon(3, 6, 5, [21, 22, 28, 30, 35, 36], 7);
hexagon[30] = new Hexagon(4, 6, 5, [22, 23, 29, 31, 36, 37], 2);
hexagon[31] = new Hexagon(5, 6, 7, [23, 24, 30, 32, 37, 38], 4);
hexagon[32] = new Hexagon(6, 6, 7, [24, 25, 31, 33, 38, 39], 3);
hexagon[33] = new Hexagon(7, 6, 3, [25, 26, 32, 34, 39, 40], 6);
hexagon[34] = new Hexagon(8, 6, 3, [26, 27, 33, 40, 41], 1);
hexagon[35] = new Hexagon(3, 7, 5, [28, 29, 36], 4);
hexagon[36] = new Hexagon(4, 7, 5, [29, 30, 35, 37, 42], 3);
hexagon[37] = new Hexagon(5, 7, 4, [30, 31, 36, 38, 42, 43], 6);
hexagon[38] = new Hexagon(6, 7, 4, [31, 32, 37, 39, 43, 44], 1);
hexagon[39] = new Hexagon(7, 7, 3, [32, 33, 38, 40, 44, 45], 5);
hexagon[40] = new Hexagon(8, 7, 3, [33, 34, 39, 41, 45, 46], 7);
hexagon[41] = new Hexagon(9, 7, 3, [34, 40, 46], 2);
hexagon[42] = new Hexagon(5, 8, 4, [36, 37, 43, 47], 5);
hexagon[43] = new Hexagon(6, 8, 4, [37, 38, 42, 44, 47, 48], 7);
hexagon[44] = new Hexagon(7, 8, 4, [38, 39, 43, 45, 48], 2);
hexagon[45] = new Hexagon(8, 8, 3, [39, 40, 44, 46], 4);
hexagon[46] = new Hexagon(9, 8, 3, [40, 41, 45], 3);
hexagon[47] = new Hexagon(6, 9, 4, [42, 43, 48], 4);
hexagon[48] = new Hexagon(7, 9, 4, [43, 44, 47], 3);

let teamColors = [];

/**
 * Draws a soldier, with a standing or walking pose. This refactored function
 * consolidates the logic from the previous `soldier` and `soldierWalking`
 * functions to reduce code duplication and improve maintainability.
 * @param {number} xHex - The x-coordinate of the hex.
 * @param {number} yHex - The y-coordinate of the hex.
 * @param {number} team - The team of the soldier.
 * @param {boolean} isWalking - True for walking pose, false for standing.
 */
function drawSoldier(xHex, yHex, team, isWalking) {
    const x = hexToXY(xHex, yHex).x - 3;
    const y = hexToXY(xHex, yHex).y + 3;

    strokeWeight(3);
    stroke(teamColors[team].mainColor);

    if (isWalking) {
        // Walking pose
        line(x, y, x, y + 15); //leg
        line(x + 1, y, x + 5, y + 15); //leg
        line(x + 1, y + 15, x + 3, y + 16); //foot
        line(x + 7, y + 15, x + 9, y + 14); //foot
        line(x + 20, y, x + 2, y - 31); //sword
    } else {
        // Standing pose
        line(x, y, x - 3, y + 15); //leg
        line(x + 5, y, x + 7, y + 15); //leg
        line(x - 4, y + 15, x + 1, y + 16); //foot
        line(x + 7, y + 15, x + 12, y + 14); //foot
        line(x + 20, y, x - 5, y - 31); //sword
    }

    // --- Common drawing for both poses ---
    fill(teamColors[team].mainColor);
    rect(x - 1, y - 8, 5, 13); //torso
    ellipse(x + 2, y - 17, 11, 11); //head
    line(x + 6, y - 7, x + 10, y); //arm
    line(x + 11, y, x + 14, y - 6);
    line(x + 12, y + 2, x + 20, y - 7); // second part of sword
    noStroke();
    fill(teamColors[team].secondaryColor);
    ellipse(x + 5, y - 18, 3, 3); //eyes
    ellipse(x + 1, y - 17, 3, 3);
    // --- Reset p5.js state ---
    stroke(0, 0, 0);
    noFill();
    strokeWeight(1);
}

/**
 * Draws an archer, with a standing or walking pose. This refactored function
 * consolidates the logic to reduce code duplication and improve maintainability.
 * @param {number} xHex - The x-coordinate of the hex.
 * @param {number} yHex - The y-coordinate of the hex.
 * @param {number} team - The team of the archer.
 * @param {boolean} isWalking - True for walking pose, false for standing.
 */
function drawArcher(xHex, yHex, team, isWalking) {
    const x = hexToXY(xHex, yHex).x + 5;
    const y = hexToXY(xHex, yHex).y + 2;

    // --- Common drawing for both poses ---
    stroke(teamColors[team].mainColor);
    fill(teamColors[team].mainColor); // Body
    ellipse(x - 11, y - 13, 9, 10); // Head
    noStroke();
    fill(teamColors[team].secondaryColor);
    ellipse(x - 9, y - 14, 3, 2); //eye
    noFill();
    stroke(teamColors[team].mainColor);
    arc(x - 2, y - 5, 15, 20, radians(-100), radians(80)); // bow
    line(x + 2, y + 5, x - 2, y - 15);  //bowstring
    line(x - 6, y - 4, x + 12, y - 8); //arrow shaft
    line(x + 12, y - 8, x + 9, y - 9); //arrowhead
    line(x + 12, y - 8, x + 9, y - 5); //arrowhead
    line(x - 6, y - 4, x - 7, y - 1); //feathers
    line(x - 6, y - 4, x - 8, y - 7);
    line(x - 3, y - 4, x - 4, y - 1);
    line(x - 3, y - 4, x - 5, y - 8);
    line(x - 10, y - 9, x + 5, y - 7); //arm
    strokeWeight(3);
    line(x - 10, y - 4, x - 8, y + 5); //torso

    // --- Pose-specific drawing for legs and feet ---
    if (isWalking) {
        line(x - 8, y + 5, x - 6, y + 15);    // Back leg
        line(x - 8, y + 5, x - 10, y + 15);   // Front leg
        line(x - 6, y + 15, x - 3, y + 14);   // Back foot
        line(x - 10, y + 15, x - 13, y + 16); // Front foot
    } else { // Standing pose
        line(x - 8, y + 5, x, y + 14);        // Right leg
        line(x - 8, y + 5, x - 10, y + 14);   // Left leg
        line(x, y + 14, x + 3, y + 12);       // Right foot
        line(x - 10, y + 14, x - 7, y + 15);  // Left foot
    }

    // --- Reset p5.js state ---
    stroke(0, 0, 0);
    noFill();
    strokeWeight(1);
}

/**
 * Draws a cavalry unit, with a standing or walking pose.
 * @param {number} xHex - The x-coordinate of the hex.
 * @param {number} yHex - The y-coordinate of the hex.
 * @param {number} team - The team of the cavalry.
 * @param {boolean} isWalking - True for walking pose, false for standing.
 */
function drawCavalry(xHex, yHex, team, isWalking) {
    const x = hexToXY(xHex, yHex).x;
    const y = hexToXY(xHex, yHex).y;

    push();
    translate(x, y); // Center drawing on the hex

    // Set colors based on team
    stroke(teamColors[team].mainColor);
    fill(teamColors[team].mainColor);
    rectMode(CENTER);

    // --- Apply overall scaling and counter-scale stroke weight ---
    const scaleFactor = 0.85;
    scale(scaleFactor);
    strokeWeight(2 / scaleFactor);

    // --- Define base X and Y offsets to position the whole drawing ---
    const offsetX = -3; // Moved 1px right
    const offsetY = -2; // Moved 1px down

    // Body (more rectangular)
    rect(offsetX, 5 + offsetY, 22, 13, 5);

    // Neck (moved right on the body)
    quad(offsetX + 7, -2 + offsetY, offsetX + 11, -2 + offsetY, offsetX + 14, -8 + offsetY, offsetX + 12, -8 + offsetY);

    // Head (thicker, with elongated and tapered snout)
    beginShape();
    vertex(offsetX + 12, -15 + offsetY); // Top of head
    vertex(offsetX + 24, -9 + offsetY);  // Snout tip (further right, more tapered)
    vertex(offsetX + 22, -7 + offsetY);  // Mouth/jaw (adjusted for new snout)
    vertex(offsetX + 13, -7 + offsetY);  // Connects to neck
    endShape(CLOSE);

    // Eye (adjusted for new head shape and moved down)
    push();
    strokeWeight(3 / scaleFactor); // Make eye slightly larger and more visible
    stroke(teamColors[team].secondaryColor); // Use secondary color for eye
    point(offsetX + 16, -12.5 + offsetY);
    pop();

    // Ear
    triangle(offsetX + 12, -14 + offsetY, offsetX + 14, -17 + offsetY, offsetX + 16, -14 + offsetY);

    // Tail (longer, with a more pronounced downward arc)
    noFill();
    const tailBaseX = offsetX - 11;
    const tailBaseY = 0 + offsetY;
    line(tailBaseX, tailBaseY, tailBaseX - 9, tailBaseY + 6);
    line(tailBaseX, tailBaseY, tailBaseX - 10, tailBaseY + 9);
    line(tailBaseX, tailBaseY, tailBaseX - 9, tailBaseY + 12);

    // Legs (with a bend in the middle)
    const legTopY = 12 + offsetY;
    const legBottomY = 24 + offsetY;
    const kneeY = legTopY + (legBottomY - legTopY) / 2;
    const kneeBend = -2; // Bend amount (backwards)

    // A helper function to draw one bent leg
    const drawBentLeg = (topX, bottomX) => {
        const kneeX = (topX + bottomX) / 2 + kneeBend;
        line(topX, legTopY, kneeX, kneeY);
        line(kneeX, kneeY, bottomX, legBottomY);
    };

    drawBentLeg(offsetX - 8, isWalking ? offsetX - 10 : offsetX - 8); // Far back leg
    drawBentLeg(offsetX + 6, isWalking ? offsetX + 4 : offsetX + 6);   // Far front leg
    drawBentLeg(offsetX - 6, isWalking ? offsetX - 4 : offsetX - 6);  // Near back leg
    drawBentLeg(offsetX + 8, isWalking ? offsetX + 10 : offsetX + 8);   // Near front leg

    pop(); // Restore original drawing state
    rectMode(CORNER); // Reset rect mode to default to avoid side-effects
}

/**
 * Draws a cannon unit, with a standing or walking pose.
 * @param {number} xHex - The x-coordinate of the hex.
 * @param {number} yHex - The y-coordinate of the hex.
 * @param {number} team - The team of the cannon.
 * @param {boolean} isWalking - True for walking pose, false for standing.
 */
function drawCannon(xHex, yHex, team, isWalking) {
    const x = hexToXY(xHex, yHex).x;
    const y = hexToXY(xHex, yHex).y;

    push();
    translate(x, y + 5); // Center drawing on the hex, slightly lower

    // Set colors
    stroke(teamColors[team].mainColor);
    fill(teamColors[team].mainColor);
    strokeWeight(3);

    // Barrel (a thick line)
    const barrelLength = 20;
    const barrelAngle = -PI / 6; // 30 degrees up
    const barrelX = barrelLength * cos(barrelAngle);
    const barrelY = barrelLength * sin(barrelAngle);
    line(0, 0, barrelX, barrelY);

    // Carriage/Base (a simple rectangle)
    noStroke();
    fill(teamColors[team].secondaryColor);
    rect(-10, 2, 20, 6, 2);

    pop();
    strokeWeight(1); // Reset
}

/**
 * @private
 * A dispatcher function that calls the correct drawing function based on the unit type.
 * This is the core of the refactoring, allowing `drawUnit` and `drawUnitWalking` to be
 * simplified into single-line calls.
 * @param {number} xHex - The x-coordinate of the hex.
 * @param {number} yHex - The y-coordinate of the hex.
 * @param {number} unitType - The type of unit (1 for soldier, 2 for archer).
 * @param {number} team - The team of the unit.
 * @param {boolean} isWalking - True for walking pose, false for standing.
 */
function _drawUnit(xHex, yHex, unitType, team, isWalking) {
    if (unitType === 1) drawSoldier(xHex, yHex, team, isWalking);
    else if (unitType === 2) drawArcher(xHex, yHex, team, isWalking);
    else if (unitType === 3) drawCavalry(xHex, yHex, team, isWalking);
    else if (unitType === 4) drawCannon(xHex, yHex, team, isWalking);
}

function drawUnit(xHexE, yHexE, unit, team)   {
    _drawUnit(xHexE, yHexE, unit, team, false);
};

function drawUnitWalking(xHexF, yHexF, unit, team)    {
    _drawUnit(xHexF, yHexF, unit, team, true);
};

/**
 * @private
 * Calculates a potential cannon target group based on an aiming hex.
 * @param {number} aimingHexIndex - The index of the hex being aimed at.
 * @param {Array<number>} potentialTargets - The list of hexes in the cannon's firing ring.
 * @returns {Array<number>} An array of hex indices that form the target group.
 */
function _calculateCannonTargetGroup(aimingHexIndex, potentialTargets) {
    if (aimingHexIndex === -1) return [];

    const ringSet = new Set(potentialTargets);
    const newTargetGroup = [];
    const aimingHex = hexagon[aimingHexIndex];

    // Check if the aiming point itself is a valid target.
    if (ringSet.has(aimingHexIndex)) {
        newTargetGroup.push(aimingHexIndex);
    }

    // Check each of the aiming point's neighbors.
    if (aimingHex && aimingHex.adjacencies) {
        for (const neighborIndex of aimingHex.adjacencies) {
            if (ringSet.has(neighborIndex)) {
                newTargetGroup.push(neighborIndex);
            }
        }
    }
    return newTargetGroup;
}

/**
 * Draws the UI for cannon targeting, highlighting the ring of potential targets.
 */
function drawCannonTargetingUI() {
    // Part 1: Draw persistent threats from all cannons on the board.

    // First, count how many cannons from each team threaten each hex. This allows us to
    // draw a thicker border for hexes threatened by multiple cannons.
    const threatsByHex = new Map();
    for (const [cannonIndex, threatData] of gameState.cannonThreats.entries()) {
        // Only consider threats from active cannons, regardless of team.
        if (hexagon[cannonIndex].unit === 4) {
            const team = hexagon[cannonIndex].team;
            for (const hexIndex of threatData.threatenedHexes) {
                if (!threatsByHex.has(hexIndex)) {
                    threatsByHex.set(hexIndex, { [PLAYER_TEAM]: 0, [ENEMY_TEAM]: 0 });
                }
                threatsByHex.get(hexIndex)[team]++;
            }
        }
    }

    // Now, draw the borders based on the threat count and team.
    for (const [hexIndex, threatInfo] of threatsByHex.entries()) {
        const hex = hexagon[hexIndex];
        const pos = hexToXY(hex.xHex, hex.yHex);
        noFill();

        // Prioritize enemy threat color if both teams threaten the same hex.
        let strokeColor;
        let weight = 4;
        if (threatInfo[ENEMY_TEAM] > 0) {
            strokeColor = color(139, 0, 0); // Dark red for enemy threat
            weight = (threatInfo[ENEMY_TEAM] >= 2) ? 8 : 4;
        } else if (threatInfo[PLAYER_TEAM] > 0) {
            strokeColor = color(0, 0, 139); // Dark blue for player threat
            weight = (threatInfo[PLAYER_TEAM] >= 2) ? 8 : 4;
        } else { continue; } // Should not happen, but as a safeguard.
        stroke(strokeColor);
        strokeWeight(weight);
        drawMiniHexagon(pos.x, pos.y, r);
    }

    // Only draw if a cannon is selected and it has potential targets.
    if (gameState.selected === -1 || hexagon[gameState.selected].unit !== 4 || gameState.potentialCannonTargets.length === 0) {
        return;
    }

    // If we are in aiming mode, the highlight is locked, so we don't update it.
    // Otherwise, it's a live preview that follows the mouse.
    if (!gameState.cannonIsAiming) {
        gameState.highlightedCannonTargetGroup = null;
        const aimingHexIndex = findClosestHexToMouse();
        gameState.lastAimingHexIndex = aimingHexIndex;

        const hoveredHexIndex = findClickedHex();

        if (hoveredHexIndex !== -1 && gameState.validMoves.has(hoveredHexIndex)) {
            gameState.highlightedCannonTargetGroup = null; // Explicitly clear the highlight
        } else {
            if (aimingHexIndex !== -1) {
                gameState.highlightedCannonTargetGroup = _calculateCannonTargetGroup(aimingHexIndex, gameState.potentialCannonTargets);
            }
        }
    }

    // Draw all potential targets with a semi-transparent overlay.
    for (const hexIndex of gameState.potentialCannonTargets) {
        const hex = hexagon[hexIndex];
        const pos = hexToXY(hex.xHex, hex.yHex);
        fill(255, 165, 0, 80); // Transparent orange
        noStroke();
        drawMiniHexagon(pos.x, pos.y, r);
    }

    // Draw the highlighted target group more prominently.
    if (gameState.highlightedCannonTargetGroup) {
        for (const hexIndex of gameState.highlightedCannonTargetGroup) {
            const hex = hexagon[hexIndex];
            const pos = hexToXY(hex.xHex, hex.yHex);

            // Use blue for the player's aiming preview to distinguish from the AI's red.
            fill(0, 0, 255, 150); // More opaque blue
            stroke(255, 255, 0); // Yellow border
            strokeWeight(3);
            drawMiniHexagon(pos.x, pos.y, r);
        }
    }
}

const STATUS_MESSAGES = {
    1: { size: 20, lines: ["Click on Unit"], x: 120, y: -180 },
    2: { size: 20, lines: ["Move to Open Hex"], x: 115, y: -180 },
    3: { size: 20, lines: ["Can't go there"], x: 120, y: -180 },
    4: { size: 20, lines: ["Click on your", "own units,", "dude!"], x: [115, 130, 145], y: [-188, -167, -146] },
    5: { size: 20, lines: ["No more moves.", "Click 'End Turn'"], x: [115, 125], y: [-188, -167] },
    6: { size: 20, lines: ["Already moved", "from this zone."], x: [115, 125], y: [-188, -167] },
    7: { size: 20, lines: ["Click 'Zoom In' to", "confirm. Deselect", "zone to exit."], x: [115, 125, 135], y: [-188, -167, -146] },
    // Consolidated messages
    8: { size: 20, lines: ["Select zone", "to Zoom in"], x: [115, 125], y: [-188, -167] },
    9: { size: 20, lines: ["Where to?"], x: 130, y: -180 },
    10: { size: 20, lines: ["Select target", "hexes"], x: [115, 125], y: [-188, -167] },
    11: { size: 20, lines: ["Move or Select", "target hexes"], x: [115, 125], y: [-188, -167] },
    12: { size: 20, lines: ["Tap again to confirm", "or aim elsewhere"], x: [115, 125], y: [-188, -167] },
};

/**
 * @private
 * Helper function to draw a status message from a data object. This function
 * iterates through the `lines` array in the message data, so it can render
 * both single-line and multi-line messages.
 * @param {object} messageData - The message object from STATUS_MESSAGES.
 */
function _drawMessageText(messageData) {
    if (!messageData) return;

    fill(82, 4, 4);
    textSize(messageData.size * boardScale);
    for (let i = 0; i < messageData.lines.length; i++) {
        const x = Array.isArray(messageData.x) ? messageData.x[i] : messageData.x;
        const y = Array.isArray(messageData.y) ? messageData.y[i] : messageData.y;
        text(messageData.lines[i], x * boardScale, y * boardScale);
    }
}

function showStatusMessage() {
    let messageKey = null;

    // Determine which message to show based on game state.
    if (gameState.zoneSelectionMode) {
        messageKey = gameState.selectedZone !== null ? 7 : 8;
    } else if (gameState.badClick > 0) {
        messageKey = gameState.badClick;
    } else if (gameState.selected !== -1) { // A unit is selected
        const selectedUnit = hexagon[gameState.selected];
        if (selectedUnit.unit === 4) { // It's a cannon
            const canMove = gameState.validMoves.size > 0;
            const canFire = gameState.potentialCannonTargets.length > 0;

            if (gameState.cannonIsAiming) {
                messageKey = 12; // "Tap again to confirm..."
            } else if (canMove && canFire) {
                messageKey = 11; // "Move or Select target hexes"
            } else if (canFire) {
                messageKey = 10; // "Select target hexes"
            } else {
                messageKey = 9; // "Where to?" (move only)
            }
        } else {
            // Default for other units
            messageKey = 9; // "Where to?"
        }
    }

    // If a message key was determined, draw the corresponding message.
    if (messageKey !== null) {
        _drawMessageText(STATUS_MESSAGES[messageKey]);
    }
}

/**
 * @private
 * Determines the state of the scout message. This is the single source of truth
 * for both drawing the message and checking if the bonus is active.
 * @returns {{show: boolean, lost: boolean}} An object indicating if the message should be shown, and if the opportunity is lost.
 */
function _getScoutMessageState() {
    // Condition 1: The feature is available on level 4 and 6+, but not level 5.
    if (gameState.level < 4 || gameState.level === 5) {
        return { show: false, lost: false };
    }

    // Condition 2: The feature has already been used or expired on this level.
    if (gameState.scoutMessageShownOnLevels.has(gameState.level)) {
        return { show: false, lost: true };
    }

    // Condition 3: It must be the player's turn and a secret zone must be set.
    if (!gameState.isPlayerTurn || !gameState.secretArcherZone) {
        return { show: false, lost: false };
    }

    // Condition 4: Check turn count and moves made.
    const movesMade = gameState.zonesMovedFromThisTurn.size;
    const turnCount = gameState.playerTurnCount;
    const moveThreshold = 5 - turnCount;

    if (turnCount >= 1 && turnCount <= 4) {
        if (movesMade < moveThreshold) {
            // The opportunity is available.
            return { show: true, lost: false };
        } else {
            // The opportunity is lost for this turn, but we still show the "lost" message.
            return { show: true, lost: true };
        }
    }

    // If none of the above conditions for showing the message are met.
    return { show: false, lost: false };
}

/**
 * Draws a message at the bottom of the screen hinting at a bonus for zooming in.
 * The message is only shown on the first few turns of a level.
 */
function drawScoutMessage() {
    const { show, lost } = _getScoutMessageState();

    if (!show) {
        return;
    }

    const message = !lost
        ? `Your scouts have encountered an archer sympathetic to your cause in the countryside beyond Zone ${gameState.secretArcherZone}.`
        : "Unfortunately, your scouts have lost track of the friendly archer.  Perhaps he will turn up again later.";
    // Position the message vertically below the board.
    const boardBottomY = 200 * boardScale;
    const messageY = boardBottomY + 30 * boardScale; // Position below the board

    fill(50, 50, 150); // A dark, strategic blue
    textSize(14 * boardScale);
    textAlign(CENTER, CENTER);

    const boxWidth = width * 0.5;
    const boxX = -boxWidth / 2;

    text(message, boxX, messageY, boxWidth);
}

/**
 * @private
 * A generic helper to draw informational messages at the bottom of the screen.
 * This consolidates the styling and positioning logic from several other functions.
 * @param {string} message - The text content of the message.
 */
function _drawBottomScreenMessage(message) {
    // Position the message vertically below the board.
    const boardBottomY = 200 * boardScale;
    const messageY = boardBottomY + 30 * boardScale; // Position below the board

    fill(50, 50, 150); // A dark, strategic blue
    textSize(14 * boardScale);
    textAlign(CENTER, CENTER);

    const boxWidth = width * 0.5; // Make it narrower to avoid UI collision
    const boxX = -boxWidth / 2;

    text(message, boxX, messageY, boxWidth);
}
/**
 * Draws a message at the bottom of the screen explaining cannon units.
 * This message is only shown on level 5.
 */
function drawCannonMessage() {
    // Only show this message on level 5, and only the first time the player reaches it.
    if (gameState.level !== 5 || gameState.hasBeenOnLevel5) {
        return;
    }
    const message = `Cannons must be aimed to function but attack at double strength. A 4-unit advantage in a zone creates a cannon on the next level.`;
    _drawBottomScreenMessage(message);
}
/**
 * Draws a message at the bottom of the screen explaining cavalry units.
 * This message is only shown on level 2.
 */
function drawCavalryMessage() {
    // Only show this message on level 2, and only the first time the player reaches it.
    if (gameState.level !== 2 || gameState.hasBeenOnLevel2) {
        return;
    }
    const message = `Cavalry fight like soldiers, but can travel 2 hexes per move. Control a zone with a 3-unit advantage to get a cavalry on the next level.`;
    _drawBottomScreenMessage(message);
}

/**
 * Draws a message at the bottom of the screen explaining archer units.
 * This message is only shown on level 3.
 */
function drawArcherMessage() {
    // Only show this message on level 3, and only the first time the player reaches it.
    if (gameState.level !== 3 || gameState.hasBeenOnLevel3) {
        return;
    }
    const message = `Archers engage enemies on adjacent hexes and from 2 hexes away.  Control a zone with a 6 or 7 unit advantage to create an archer on the next level.`;
    _drawBottomScreenMessage(message);
}

/**
 * Draws a message at the bottom of the screen informing the player which zone on the higher level
 * they are currently fighting for. This is only shown after a zoom-in.
 */
function drawZoomOutTargetMessage() {
    const higherLevel = gameState.level + 1;
    // Check if we are in a "zoomed-in" state by seeing if a higher level's state is stored.
    if (!gameState.levelMemory.has(higherLevel)) {
        return;
    }

    const savedData = gameState.levelMemory.get(higherLevel);
    const targetZone = savedData.excludedZone;
    const targetLevelName = LEVEL_NAMES[higherLevel - 1] || `Level ${higherLevel}`;

    const message = `You are fighting for Zone ${targetZone} on ${targetLevelName}.`;
    _drawBottomScreenMessage(message);
}

/**
 * Checks if the scout message is currently being displayed. This is the condition
 * for the player to receive a bonus archer when zooming out.
 * @returns {boolean} True if the message is active, false otherwise.
 */
function isScoutMessageActive() {
    // This function now uses the single source of truth to determine if the bonus is active.
    // The bonus is active if the message is being shown AND the opportunity has not been lost.
    const { show, lost } = _getScoutMessageState();
    return show && !lost;
}

function drawMiniHexagon(x, y, r) {
    beginShape();
    vertex(x, y - r);
    vertex(x + r * sqrt(3) / 2, y - r / 2);
    vertex(x + r * sqrt(3) / 2, y + r / 2);
    vertex(x, y + r);
    vertex(x - r * sqrt(3) / 2, y + r / 2);
    vertex(x - r * sqrt(3) / 2, y - r / 2);
    endShape(CLOSE);
}

function drawAvailableMovesUI() {
    push();

    // Use pre-calculated layout values for efficiency instead of recalculating every frame.
    const { dotRadius, borderWidth, titleSize, titleYOffset, baseX, baseY, spacing } = uiLayout;

    translate(baseX, baseY);

    // Draw the heading first, so it is not affected by the cluster's rotation
    fill(0);
    noStroke();
    textSize(titleSize);
    textAlign(CENTER, CENTER);
    text("Moves Left", 0, titleYOffset);

    // Now, apply a rotation to the coordinate system for the hexagon cluster.
    // PI is 180 degrees, so PI / 12 is 15 degrees.
    rotate(PI / 12);

    // --- Pass 1: Draw the solid black background shape ---
    // This creates a single, solid black cluster that the colored hexes will be drawn on top of.
    fill(0);
    noStroke();
    for (const dot of UI_DOT_LAYOUT) {
        push();
        translate(dot.x * spacing, dot.y * spacing);
        rotate(PI / 6);
        drawMiniHexagon(0, 0, dotRadius);
        pop();
    }

    // --- Pass 2: Draw smaller colored/white fills on top to create the border effect ---
    const fillRadius = dotRadius - (borderWidth / sqrt(3));
    noStroke();
    for (const dot of UI_DOT_LAYOUT) {
        // Determine the fill color based on whose turn it is.
        let fillStyle;
        if (gameState.isPlayerTurn) {
            // Player logic: white if used, zone color otherwise.
            if (gameState.zonesMovedFromThisTurn.has(dot.zone)) {
                fillStyle = color(255); // White for used moves
            } else {
                fillStyle = zoneColor[dot.zone];
            }
        } else {
            // AI logic: white if used, zone color if available, gray if unavailable.
            if (gameState.aiZonesMovedFromThisTurn.has(dot.zone)) {
                fillStyle = color(255); // White for used moves
            } else {
                // Like the player's turn, show all zones as available until used.
                fillStyle = zoneColor[dot.zone];
            }
        }
        fill(fillStyle);
        push();
        translate(dot.x * spacing, dot.y * spacing);
        rotate(PI / 6);
        drawMiniHexagon(0, 0, fillRadius);

        // Draw the zone number on top, ensuring it's upright
        // The context is rotated by PI/12 (cluster) + PI/6 (hex) = PI/4
        rotate(-PI / 4);
        fill(0); // Black text
        textSize(fillRadius * 0.9); // Scale text to fit
        textAlign(CENTER, CENTER);
        text(dot.zone, 0, 0);
        pop();
    }
    pop(); // Restore the original, un-rotated drawing state
    textAlign(LEFT, BASELINE); // Reset alignment globally
}
/**
 * Determines if a unit on a given hex is surrounded by enough threats to be eliminated.
 * A unit is surrounded if it has 3 or more threats.
 * - Adjacent units of any type count as a threat.
 * - Ranged units (archers) two hexes away also count as a threat.
 * @param {number} targetHexIndex - The index of the hex to check.
 * @param {number} attackingTeam - The team that is performing the attack.
 * @returns {boolean} True if the unit is surrounded, false otherwise.
 */
function isSurrounded(targetHexIndex, attackingTeam) {
    const defendingTeam = (attackingTeam === PLAYER_TEAM) ? ENEMY_TEAM : PLAYER_TEAM;

    // 1. Validate the target: It must be an occupied hex of the defending team.
    if (hexagon[targetHexIndex].unit === 0 || hexagon[targetHexIndex].team !== defendingTeam) {
        return false;
    }

    let totalThreats = 0;
    const directNeighborSet = new Set(hexagon[targetHexIndex].adjacencies);

    // 2. Check for persistent cannon threats first.
    for (const [cannonIndex, threatData] of gameState.cannonThreats.entries()) {
        // A cannon's threat only counts if it belongs to the attacking team and is targeting the hex.
        if (hexagon[cannonIndex].team === attackingTeam && threatData.threatenedHexes.includes(targetHexIndex)) {
            totalThreats += 2; // Cannons provide 2 threats to their target area.
        }
    }

    // 3. Get all hexes within range 2 and check for standard threats.
    const nearbyHexIndices = getHexesInRange(targetHexIndex, 2);
    for (const hexIndex of nearbyHexIndices) {
        const attacker = hexagon[hexIndex];
        // Cannons do not provide a standard adjacent/ranged threat, only their special targeted threat.
        if (attacker.team === attackingTeam && attacker.unit !== 0) {
            if (directNeighborSet.has(hexIndex)) {
                // It's an adjacent threat. Cannons do not provide adjacent threat.
                if (attacker.unit !== 4) {
                    totalThreats++;
                }
            } else if (attacker.unit === 2) {
                // It's a ranged threat (must be an archer).
                totalThreats++;
            }
        }
    }

    return totalThreats > 2;
}

/**
 * Calculates all valid moves for a unit at a given index.
 * Soldiers/Archers move 1 hex. Cavalry can move 2 hexes through an open space.
 * @param {number} unitIndex - The index of the unit to calculate moves for.
 * @returns {Array<number>} An array of valid destination hex indices.
 */
function getValidMovesForUnit(unitIndex) {
    const unit = hexagon[unitIndex];
    const validMoves = [];

    if (unit.unit === 1 || unit.unit === 2 || unit.unit === 4) { // Soldier, Archer, or Cannon
        for (const adjIndex of unit.adjacencies) {
            if (hexagon[adjIndex].unit === 0) {
                validMoves.push(adjIndex);
            }
        }
    } else if (unit.unit === 3) { // Cavalry
        const oneStep = [];
        // Range 1 moves
        for (const adjIndex of unit.adjacencies) {
            if (hexagon[adjIndex].unit === 0) {
                validMoves.push(adjIndex);
                oneStep.push(adjIndex); // Store for checking range 2
            }
        }
        // Range 2 moves (must pass through an empty hex from step 1)
        for (const intermediateIndex of oneStep) {
            for (const destIndex of hexagon[intermediateIndex].adjacencies) {
                if (destIndex !== unitIndex && hexagon[destIndex].unit === 0) {
                    validMoves.push(destIndex);
                }
            }
        }
    }
    // Return a unique set of moves, as a cavalry could reach a hex via multiple paths.
    return [...new Set(validMoves)];
}

/**
 * Checks if a team has achieved dominance in a zone (5+ units)
 * and eliminates any opposing units in that zone if so.
 * @param {number} zone - The zone number to check.
 * @param {number} team - The team (PLAYER_TEAM or ENEMY_TEAM) to check for dominance.
 */
function checkZoneControl(zone, team) {
    const hexesInZone = hexesByZone.get(zone);
    const friendlyUnitsInZone = hexesInZone.filter(h => h.team === team);

    if (friendlyUnitsInZone.length >= 5) {
        const enemyTeam = (team === PLAYER_TEAM) ? ENEMY_TEAM : PLAYER_TEAM;
        let eliminated = false;
        for (const hex of hexesInZone) {
            if (hex.team === enemyTeam) {
                hex.unit = 0;
                hex.team = 0;
                eliminated = true;
            }
        }
        if (eliminated && sounds.boom2) sounds.boom2.play();
    }
}

/**
 * @private
 * Determines the type of unit that will be created on the next level based on zone dominance.
 * This function is data-driven, using the `SPECIAL_UNIT_PROMOTION_RULES` constant to make
 * the logic for unit promotion a single, extensible source of truth.
 * @param {number} advantage - The unit advantage (e.g., player units - enemy units).
 * @param {Set<number>} presentSpecialUnits - A set of special unit types already in the zone.
 * @param {number} nextLevel - The level number that the unit will be carried over TO.
 * @returns {number} The unit type (1: Soldier, 2: Archer, 3: Cavalry, 4: Cannon).
 */
function _getCarryoverUnitType(advantage, presentSpecialUnits, nextLevel) {
    for (const rule of SPECIAL_UNIT_PROMOTION_RULES) {
        const hasUnit = presentSpecialUnits.has(rule.unitType);

        // Check for creation via advantage
        const canCreateByAdvantage = advantage >= rule.advantage;

        // Check level requirements for creation
        let levelRequirementMet = nextLevel >= rule.minLevel;
        if (rule.specialLevelCheck) {
            levelRequirementMet = levelRequirementMet || rule.specialLevelCheck();
        }

        if (hasUnit || (canCreateByAdvantage && levelRequirementMet)) {
            return rule.unitType;
        }
    }
    return 1; // Default to Soldier
}

/**
 * Calculates which team has dominance in each zone at the end of a level.
 * Dominance is achieved by having at least 2 more units than the opponent.
 * Also determines the unit type that will carry over to the next level's center board.
 * A player can earn an archer by either having one in a captured zone, or by
 * occupying all six "outer" hexes of a captured zone.
 * @returns {object} An object mapping zone numbers to dominance info {team, unitType}.
 */
function calculateZoneDominance() { // Simplified archer logic
    const zoneDominance = {};
    for (let zone = 1; zone <= 7; zone++) {
        const hexesInZone = hexesByZone.get(zone);
        const playerUnitsInZone = hexesInZone.filter(h => h.team === PLAYER_TEAM);
        const enemyUnitsInZone = hexesInZone.filter(h => h.team === ENEMY_TEAM);
        const playerUnitCount = playerUnitsInZone.length;
        const enemyUnitCount = enemyUnitsInZone.length;

        const playerAdvantage = playerUnitCount - enemyUnitCount;
        const enemyAdvantage = enemyUnitCount - playerUnitCount;

        if (playerAdvantage >= 2) {
            const presentSpecialUnits = new Set(playerUnitsInZone.filter(u => u.unit > 1).map(u => u.unit));
            const unitType = _getCarryoverUnitType(playerAdvantage, presentSpecialUnits, gameState.level + 1);
            zoneDominance[zone] = { team: PLAYER_TEAM, unitType: unitType };
        } else if (enemyAdvantage >= 2) {
            const presentSpecialUnits = new Set(enemyUnitsInZone.filter(u => u.unit > 1).map(u => u.unit));
            const unitType = _getCarryoverUnitType(enemyAdvantage, presentSpecialUnits, gameState.level + 1);
            zoneDominance[zone] = { team: ENEMY_TEAM, unitType: unitType };
        } else {
            // No team has dominance.
            zoneDominance[zone] = { team: 0, unitType: 1 };
        }
    }
    return zoneDominance;
}

/**
 * Saves the current state of the outer zones (1-6) for a given level.
 * This is now generalized to exclude any specified zone, which is crucial for the
 * zoom-in/zoom-out mechanic.
 * @param {number} level - The level number to save the state for.
 * @param {number} excludedZone - The zone number whose hexes should NOT be saved.
 */
function saveOuterZoneState(level, excludedZone) {
    const outerZoneState = [];
    const hexesToExclude = hexesByZone.get(excludedZone);
    const indicesToExclude = new Set(hexesToExclude.map(h => hexagon.indexOf(h)));

    for (let i = 0; i < hexagon.length; i++) {
        if (!indicesToExclude.has(i)) {
            outerZoneState.push({
                index: i,
                unit: hexagon[i].unit,
                team: hexagon[i].team
            });
        }
    }
    // Store an object containing both the state and the excluded zone for clarity.
    gameState.levelMemory.set(level, { state: outerZoneState, excludedZone: excludedZone });
    console.log(`Saved board state for Level ${level}, excluding Zone ${excludedZone}.`);
}

/**
 * Selects a random value from a list of weighted options.
 * @param {Array<{value: any, weight: number}>} options - An array of option objects.
 * @returns {any} The value of the chosen option.
 */
function getWeightedRandom(options) {
    const totalWeight = options.reduce((sum, opt) => sum + opt.weight, 0);
    let randomNum = random(totalWeight);
    for (const opt of options) {
        if (randomNum < opt.weight) {
            return opt.value;
        }
        randomNum -= opt.weight;
    }
    return options[options.length - 1].value; // Fallback
}

/**
 * Generates the board state for a new, lower level by "zooming in" on a
 * specific zone from the current level.
 * @param {number} sourceZone - The zone number from the current level to zoom into.
 * @returns {Array<{unit: number, team: number}>} An array representing the full board state.
 */
function generateZoomInBoard(sourceZone) {
    const boardState = [];
    for (let i = 0; i < hexagon.length; i++) {
        boardState[i] = { unit: 0, team: 0 };
    }

    // --- Define weighted probability tables for unit distribution ---
    // These tables reflect the "power level" of the source hex, while also
    // maintaining the principle that zoom-ins are slightly more difficult.

    // For Soldier hexes (reflects a +2 advantage, penalized to ~+1)
    const playerSoldierOptions = [
        { value: [3, 2], weight: 4 }, { value: [2, 1], weight: 3 },
        { value: [4, 2], weight: 2 }, { value: [1, 0], weight: 1 }
    ];
    const enemySoldierOptions = [
        { value: [2, 3], weight: 4 }, { value: [1, 2], weight: 3 },
        { value: [2, 4], weight: 2 }, { value: [0, 1], weight: 1 }
    ];

    // For Cavalry hexes (reflects a +3 advantage, penalized to ~+2)
    const playerCavalryOptions = [
        { value: [4, 2], weight: 4 }, { value: [3, 1], weight: 3 },
        { value: [5, 2], weight: 2 }, { value: [2, 0], weight: 1 }
    ];
    const enemyCavalryOptions = [
        { value: [2, 4], weight: 4 }, { value: [1, 3], weight: 3 },
        { value: [2, 5], weight: 2 }, { value: [0, 2], weight: 1 }
    ];

    // For Archer hexes (reflects a +6 advantage, penalized to ~+4/5)
    const playerArcherOptions = [
        { value: [5, 1], weight: 4 }, { value: [6, 1], weight: 3 },
        { value: [4, 0], weight: 2 }, { value: [6, 0], weight: 1 }
    ];
    const enemyArcherOptions = [
        { value: [1, 5], weight: 4 }, { value: [1, 6], weight: 3 },
        { value: [0, 4], weight: 2 }, { value: [0, 6], weight: 1 }
    ];

    // For Neutral hexes (slight enemy advantage, as per original design)
    const neutralOptions = [
        { value: [2, 3], weight: 4 }, // 5 units, enemy advantage
        { value: [1, 2], weight: 2 }, // 3 units, enemy advantage
        { value: [2, 4], weight: 2 }, // 6 units, enemy advantage
        { value: [0, 1], weight: 1 }  // 1 unit, enemy advantage
    ];

    // 1. Find the center and outer hexes of the source zone.
    const sourceHexes = hexesByZone.get(sourceZone);
    const avgX = sourceHexes.reduce((sum, h) => sum + h.xHex, 0) / sourceHexes.length;
    const avgY = sourceHexes.reduce((sum, h) => sum + h.yHex, 0) / sourceHexes.length;
    const centerHex = sourceHexes.reduce((closest, current) => {
        const closestDist = (closest.xHex - avgX) ** 2 + (closest.yHex - avgY) ** 2;
        const currentDist = (current.xHex - avgX) ** 2 + (current.yHex - avgY) ** 2;
        return currentDist < closestDist ? current : closest;
    });
    const outerHexes = sourceHexes.filter(h => h !== centerHex);

    // 2. Map the outer hexes to the 6 outer zones of the new board based on coordinate offset.
    const sourceHexToNewZoneMap = new Map();
    sourceHexToNewZoneMap.set(centerHex, 7); // Center hex always maps to new Zone 7.

    // This map defines the relationship between a hex's position relative to its
    // zone's center and the new zone it will populate in the lower level.
    const offsetToNewZone = {
        "0,-1": 1,  // Top hex maps to new Zone 1
        "1,0": 2,   // Top-right hex maps to new Zone 2
        "1,1": 3,   // Bottom-right hex maps to new Zone 3
        "0,1": 4,   // Bottom hex maps to new Zone 4
        "-1,0": 5,  // Bottom-left hex maps to new Zone 5
        "-1,-1": 6  // Top-left hex maps to new Zone 6
    };

    for (const outerHex of outerHexes) {
        const dx = outerHex.xHex - centerHex.xHex;
        const dy = outerHex.yHex - centerHex.yHex;
        const offsetKey = `${dx},${dy}`;
        const newZone = offsetToNewZone[offsetKey];
        if (newZone) sourceHexToNewZoneMap.set(outerHex, newZone);
    }

    // 3. Populate the new board zone by zone.
    for (const [sourceHex, newZoneNum] of sourceHexToNewZoneMap.entries()) {
        const hexesInNewZone = hexagon.map((h, i) => ({...h, index: i})).filter(h => h.zone === newZoneNum).map(h => h.index);

        let unitCounts, playerUnits, enemyUnits;
        let hasArcher = false, hasCavalry = false, specialUnitTeam = 0;

        if (sourceHex.team === PLAYER_TEAM) {
            specialUnitTeam = PLAYER_TEAM;
            if (sourceHex.unit === 2) { // Player Archer
                if (random() < 0.5) { // 50% chance for direct carryover
                    unitCounts = getWeightedRandom(playerSoldierOptions);
                    hasArcher = true;
                } else { // 50% chance for soldier advantage
                    unitCounts = getWeightedRandom(playerArcherOptions);
                }
            } else if (sourceHex.unit === 3) { // Player Cavalry
                if (random() < 0.5) { // 50% chance for direct carryover
                    unitCounts = getWeightedRandom(playerSoldierOptions);
                    hasCavalry = true;
                } else { // 50% chance for soldier advantage
                    unitCounts = getWeightedRandom(playerCavalryOptions);
                }
            } else { // Soldier
                unitCounts = getWeightedRandom(playerSoldierOptions);
            }
        } else if (sourceHex.team === ENEMY_TEAM) {
            specialUnitTeam = ENEMY_TEAM;
            if (sourceHex.unit === 2) { // Enemy Archer
                if (random() < 0.5) { // 50% chance for direct carryover
                    unitCounts = getWeightedRandom(enemySoldierOptions);
                    hasArcher = true;
                } else { // 50% chance for soldier advantage
                    unitCounts = getWeightedRandom(enemyArcherOptions);
                }
            } else if (sourceHex.unit === 3) { // Enemy Cavalry
                if (random() < 0.5) { // 50% chance for direct carryover
                    unitCounts = getWeightedRandom(enemySoldierOptions);
                    hasCavalry = true;
                } else { // 50% chance for soldier advantage
                    unitCounts = getWeightedRandom(enemyCavalryOptions);
                }
            } else { // Soldier
                unitCounts = getWeightedRandom(enemySoldierOptions);
            }
        } else { // Neutral
            unitCounts = getWeightedRandom(neutralOptions);
        }

        playerUnits = unitCounts[0];
        enemyUnits = unitCounts[1];

        const unitPool = [];
        for (let i = 0; i < playerUnits; i++) unitPool.push({ unit: 1, team: PLAYER_TEAM });
        for (let i = 0; i < enemyUnits; i++) unitPool.push({ unit: 1, team: ENEMY_TEAM });
        while (unitPool.length < hexesInNewZone.length) unitPool.push({ unit: 0, team: 0 });

        shuffle(unitPool, true);

        for (let i = 0; i < hexesInNewZone.length; i++) {
            boardState[hexesInNewZone[i]] = unitPool[i];
        }

        // If the source hex had an archer, convert one of the new soldiers.
        if (hasArcher && (gameState.level - 1 >= 3)) {
            const potentialArcherHexes = hexesInNewZone.filter(i =>
                boardState[i].team === specialUnitTeam && boardState[i].unit === 1
            );
            if (potentialArcherHexes.length > 0) {
                const hexToConvert = random(potentialArcherHexes);
                boardState[hexToConvert].unit = 2;
            }
        }

        // If the source hex had a cavalry, convert one of the new soldiers.
        if (hasCavalry && (gameState.level - 1 >= 2)) {
            const potentialCavalryHexes = hexesInNewZone.filter(i =>
                boardState[i].team === specialUnitTeam && boardState[i].unit === 1
            );
            if (potentialCavalryHexes.length > 0) {
                // Avoid converting the same hex if it was already converted to an archer (unlikely but possible)
                const hexToConvert = random(potentialCavalryHexes.filter(i => boardState[i].unit === 1));
                if (hexToConvert) boardState[hexToConvert].unit = 3;
            }
        }
    }

    // DEBUG: Add a player cannon for testing on the new lower level.
    // _addPlayerCannonForTesting(boardState);
    return boardState;
}

/**
 * Generates the unit placement for outer zones (1-6) based on difficulty.
 * This creates a less random distribution of total forces than per-hex rolls.
 * @returns {Map<number, {unit: number, team: number}>} A map of hex indices to their new unit state.
 */
function generateOuterZoneUnits() {
    // The player's chosen difficulty provides a consistent bonus/penalty.
    const difficultyModifier = Math.floor(DIFFICULTY / 2);

    // Player's dice decrease as levels increase and difficulty increases.
    // Base is 9, -1 every 2 levels starting at level 3.
    const playerLevelPenalty = Math.floor((gameState.level - 1) / 2);
    // We use Math.max to ensure the player always gets at least 1 die.
    const playerDiceCount = Math.max(1, 9 - playerLevelPenalty - difficultyModifier);

    // AI's dice increase as levels increase and difficulty increases.
    // Base is 9, +1 every 2 levels starting at level 2.
    const aiLevelBonus = Math.floor(gameState.level / 2);
    const aiDiceCount = Math.max(1, 9 + aiLevelBonus + difficultyModifier);

    // 2. "Roll" the dice to determine total unit counts. Each die yields 1 or 2 units.
    let playerUnitCount = 0;
    for (let i = 0; i < playerDiceCount; i++) {
        playerUnitCount += floor(random(2)) + 1; // A die roll of 1 or 2
    }

    let aiUnitCount = 0;
    for (let i = 0; i < aiDiceCount; i++) {
        aiUnitCount += floor(random(2)) + 1; // A die roll of 1 or 2
    }

    // 3. Get all available hexes in the outer zones
    const outerZoneIndices = [];
    for (let i = 0; i < hexagon.length; i++) {
        if (!ZONE_7_HEX_INDICES.includes(i)) {
            outerZoneIndices.push(i);
        }
    }

    // 4. Create a "pool" of all units to be placed
    const unitPool = [];
    for (let i = 0; i < playerUnitCount; i++) unitPool.push(PLAYER_TEAM);
    for (let i = 0; i < aiUnitCount; i++) unitPool.push(ENEMY_TEAM);
    const emptySlots = outerZoneIndices.length - unitPool.length;
    for (let i = 0; i < emptySlots; i++) unitPool.push(0);

    // 5. Shuffle the pool and create the placement map to return
    shuffle(unitPool, true); // p5.js shuffle function, true for in-place
    const placementMap = new Map();
    for (let i = 0; i < outerZoneIndices.length; i++) {
        const hexIndex = outerZoneIndices[i];
        const team = unitPool[i];
        placementMap.set(hexIndex, { unit: (team === 0) ? 0 : 1, team: team });
    }
    return placementMap;
}

/**
 * Generates the complete board state for the first level of the game.
 * This ensures Zone 7 and the outer zones are populated correctly without interference.
 * @returns {Array<{unit: number, team: number}>} An array representing the full board state.
 */
function generateInitialBoardState() {
    const boardState = [];
    // Initialize all hexes as empty
    for (let i = 0; i < hexagon.length; i++) {
        boardState[i] = { unit: 0, team: 0 };
    }

    // 1. Populate Zone 7 for Level 1 with 3 AI, 2 Player, 2 empty
    const zone7UnitPool = [ENEMY_TEAM, ENEMY_TEAM, ENEMY_TEAM, PLAYER_TEAM, PLAYER_TEAM, 0, 0];
    shuffle(zone7UnitPool, true);
    for (let i = 0; i < ZONE_7_HEX_INDICES.length; i++) {
        const hexIndex = ZONE_7_HEX_INDICES[i];
        const team = zone7UnitPool[i];
        boardState[hexIndex].team = team;
        boardState[hexIndex].unit = (team === 0) ? 0 : 1;
    }

    // 2. Populate Outer Zones using the dice-roll mechanism
    const outerZonePlacements = generateOuterZoneUnits();
    for (const [hexIndex, state] of outerZonePlacements.entries()) {
        boardState[hexIndex] = { unit: state.unit, team: state.team };
    }
    return boardState;
}

/**
 * Starts a new level. This function is now only used for the very first level setup.
 * Subsequent level transitions are handled by the win screen animation state machine.
 */
function startNewLevel() {
    console.log(`Starting Level: ${gameState.level + 1}`);

    // 1. Generate the complete board state for Level 1.
    const initialBoardState = generateInitialBoardState();

    // 2. Apply the generated state to the main hexagon array.
    for (let i = 0; i < hexagon.length; i++) {
        hexagon[i].unit = initialBoardState[i].unit;
        hexagon[i].team = initialBoardState[i].team;
    }

    // 4. Reset game state for the new level
    gameState = { ...gameState, selected: -1, badClick: 0, zonesMovedFromThisTurn: new Set(), endTurn: 0, isPlayerTurn: true, aiMoveQueue: [], aiZonesMovedFromThisTurn: new Set(), animationLoop: 0, animateMovementFrom: null, animateMovementTo: null, level: 1, playerTurnCount: 1, secretArcherZone: floor(random(6)) + 1, cannonsFiredThisTurn: new Set(), cannonThreats: new Map(), animateCannonThreat: null };

    // DEBUG: Add a player cannon for testing on level 1.
    // _addPlayerCannonForTesting(hexagon);
}

/**
 * Evaluates a potential move for the AI and returns a score.
 * Higher scores are better.
 * @param {number} sourceIndex - The starting hex index of the AI unit.
 * @param {number} destIndex - The potential destination hex index.
 * @returns {number} The calculated score for the move.
 */
function evaluateMove(sourceIndex, destIndex) {
    let score = random(AI_SCORING_WEIGHTS.RANDOM_TIEBREAK); // Start with a small random score to break ties
    const sourceHex = hexagon[sourceIndex];
    const destHex = hexagon[destIndex];

    // Add a small bonus for long-range cavalry moves to encourage their use.
    if (sourceHex.unit === 3 && !sourceHex.adjacencies.includes(destIndex)) {
        score += AI_SCORING_WEIGHTS.CAVALRY_LONG_MOVE;
    }


    // --- 1. Offensive Score: Check for surrounding player units ---
    for (const neighborIndex of hexagon[destIndex].adjacencies) {
        const neighborHex = hexagon[neighborIndex];
        if (neighborHex.team === PLAYER_TEAM) {
            // How many AI units are adjacent to this player unit?
            let threats = 0;
            for (const playerNeighborIndex of neighborHex.adjacencies) {
                // After our move, destIndex will be an AI unit (or already is an AI unit).
                // Cannons are no longer part of this calculation; their attack is a separate action.
                if (playerNeighborIndex === destIndex || hexagon[playerNeighborIndex].team === ENEMY_TEAM) {
                    threats++;
                }
            }
            if (threats >= 3) {
                score += AI_SCORING_WEIGHTS.CREATE_KILL; // This move creates a kill
                if (neighborHex.unit === 2) { // It's an archer!
                    score += AI_SCORING_WEIGHTS.KILL_ARCHER_BONUS; // Add a huge bonus for killing a valuable unit
                } else if (neighborHex.unit === 3) { // It's a cavalry!
                    score += AI_SCORING_WEIGHTS.KILL_CAVALRY_BONUS;
                }
            } else if (threats === 2) {
                score += AI_SCORING_WEIGHTS.SETUP_KILL; // This move sets up a kill
            }
        }
    }

    // --- 2. Defensive Score: Avoid moving into danger ---
    // The AI needs to understand all threats to a destination hex, including ranged attacks.
    let playerThreats = 0;
    const directNeighborSet = new Set(hexagon[destIndex].adjacencies);
    // We only need to check up to range 2 for archer threats.
    const nearbyHexIndices = getHexesInRange(destIndex, 2);

    for (const hexIndex of nearbyHexIndices) {
        const potentialAttacker = hexagon[hexIndex];
        // Check if there's a player unit on this hex
        if (potentialAttacker.team === PLAYER_TEAM && potentialAttacker.unit !== 0) {
            if (directNeighborSet.has(hexIndex)) {
                playerThreats++;
            } else if (potentialAttacker.unit === 2) {
                // It's a non-adjacent ranged threat (must be a player archer).
                playerThreats++;
            }
        }
    }
    // A move is dangerous if it moves into a position threatened by 2 or more player units.
    if (playerThreats >= 2) {
        score += AI_SCORING_WEIGHTS.DANGEROUS_MOVE; // This move is dangerous (value is negative)
    }

    // --- 3. Zone Control Score ---
    const destZoneHexes = hexesByZone.get(destHex.zone);

    // Get the actual player units in the destination zone to check for unit types.
    const playerUnitsInDestZone = destZoneHexes.filter(h => h.team === PLAYER_TEAM);
    const currentPlayersInDestZone = playerUnitsInDestZone.length;

    // Calculate AI units in destination zone *after* the hypothetical move
    const aiUnitsInDestZoneAfterMove = destZoneHexes.filter(h => h.team === ENEMY_TEAM).length + (sourceHex.zone !== destHex.zone ? 1 : 0);

    // Offensive Zone Control: Award points only if it results in a capture
    if (aiUnitsInDestZoneAfterMove >= 5) {
        // If the AI reaches 5 units, it captures all current player units in that zone.
        score += AI_SCORING_WEIGHTS.CAPTURE_ZONE_PER_UNIT * currentPlayersInDestZone;
        // Add a bonus for any archers that would be captured.
        for (const playerUnit of playerUnitsInDestZone) {
            if (playerUnit.unit === 2) { // It's an archer!
                score += AI_SCORING_WEIGHTS.KILL_ARCHER_BONUS;
            } else if (playerUnit.unit === 3) { // It's a cavalry!
                score += AI_SCORING_WEIGHTS.KILL_CAVALRY_BONUS;
            }
        }
    }

    // Defensive Zone Control: Penalize moving into a zone where player has 4 units
    if (currentPlayersInDestZone === 4) {
        score += AI_SCORING_WEIGHTS.VULNERABLE_ZONE; // Significant penalty for vulnerability (value is negative)
    }

    return score;
}

/**
 * Evaluates a potential cannon threat action for the AI and returns a score.
 * @param {number} cannonIndex - The index of the cannon setting the threat.
 * @param {Array<number>} targetGroup - The array of hex indices in the threat area.
 * @returns {number} The calculated score for setting the threat.
 */
function evaluateThreatAction(cannonIndex, targetGroup) {
    let score = 0;
    // Add a small base score for using the cannon at all
    score += AI_SCORING_WEIGHTS.SETUP_KILL;

    for (const hexIndex of targetGroup) {
        const hex = hexagon[hexIndex];
        if (hex.team === PLAYER_TEAM) {
            // Use CREATE_KILL as a base score for hitting any unit.
            score += AI_SCORING_WEIGHTS.CREATE_KILL;
            // Add bonuses for high-value targets.
            if (hex.unit === 2) score += AI_SCORING_WEIGHTS.KILL_ARCHER_BONUS;
            if (hex.unit === 4) score += AI_SCORING_WEIGHTS.KILL_CANNON_BONUS;
            if (hex.unit === 3) score += AI_SCORING_WEIGHTS.KILL_CAVALRY_BONUS;
        }
    }
    return score;
}

/**
 * @private
 * Converts a random soldier of a specific team to a different unit type.
 * This is a generic helper function to avoid code duplication.
 * @param {Array<Hexagon> | Array<{unit: number, team: number}>} board - The array of hexagon objects or board state objects.
 * @param {number} team - The team whose soldier should be converted (PLAYER_TEAM or ENEMY_TEAM).
 * @param {number} newUnitType - The unit type to convert the soldier to (e.g., 2 for archer, 3 for cavalry).
 * @param {string} unitTypeName - The name of the new unit type for logging purposes (e.g., 'archer').
 * @param {number | null} [excludedZone=null] - A zone number to exclude from the conversion process.
 */
function _convertRandomSoldier(board, team, newUnitType, unitTypeName, excludedZone = null) {
    const soldiers = [];
    for (let i = 0; i < board.length; i++) {
        // Check the hex's zone from the main `hexagon` array to see if it should be excluded.
        const hexZone = hexagon[i].zone;
        if (board[i].team === team && board[i].unit === 1 && hexZone !== excludedZone) {
            soldiers.push(i);
        }
    }
    if (soldiers.length > 0) {
        const randomIndex = floor(random(soldiers.length));
        const hexIndexToConvert = soldiers[randomIndex];
        board[hexIndexToConvert].unit = newUnitType;
        const teamName = (team === PLAYER_TEAM) ? "player" : "enemy";
        console.log(`Converted ${teamName} soldier at hex ${hexIndexToConvert} to a ${unitTypeName}.`);
    } else {
        const teamName = (team === PLAYER_TEAM) ? "player" : "enemy";
        console.log(`No ${teamName} soldiers found to convert to ${unitTypeName} (excluding zone ${excludedZone}).`);
    }
}

/**
 * @private
 * DEBUG: Adds a player cannon to the board for testing purposes.
 * It prioritizes placing the cannon on an empty hex in an outer zone.
 * If no empty hex is available, it will convert a random player soldier.
 * @param {Array<Hexagon> | Array<{unit: number, team: number}>} board - The array of hexagon objects or board state objects.
 */
function _addPlayerCannonForTesting(board) {
    // Find potential hexes for the cannon. Prioritize empty hexes in outer zones.
    const emptyOuterHexes = [];
    const playerSoldiers = [];

    for (let i = 0; i < board.length; i++) {
        const hexZone = hexagon[i].zone; // Always check the zone from the main hexagon definition
        if (hexZone !== 7) { // Only place in outer zones to avoid immediate conflict
            if (board[i].unit === 0) {
                emptyOuterHexes.push(i);
            } else if (board[i].team === PLAYER_TEAM && board[i].unit === 1) {
                playerSoldiers.push(i);
            }
        }
    }

    let targetHexIndex = -1;
    if (emptyOuterHexes.length > 0) {
        targetHexIndex = random(emptyOuterHexes);
        console.log(`DEBUG: Adding player cannon for testing to empty hex ${targetHexIndex}.`);
    } else if (playerSoldiers.length > 0) {
        targetHexIndex = random(playerSoldiers);
        console.log(`DEBUG: Converting player soldier to cannon for testing at hex ${targetHexIndex}.`);
    }

    if (targetHexIndex !== -1) {
        board[targetHexIndex].unit = 4; // Cannon
        board[targetHexIndex].team = PLAYER_TEAM;
    } else {
        console.log("DEBUG: Could not find a suitable spot for a test player cannon.");
    }
}
/**
 * Finds the single best move for the AI on the current board.
 * It considers all possible moves from all units in zones the AI hasn't moved from yet.
 * This is the first step in refactoring the AI to plan moves one-by-one.
 * @returns {{from: number, to: number, score: number} | null} The best move object, or null if no valid moves exist.
 */
function findBestAIMove() {
    let bestMove = { from: -1, to: -1, score: -Infinity };
    const availableZones = new Set();

    // First, determine which zones are available to move from.
    // An AI unit must exist in a zone for it to be considered.
    for (let i = 0; i < hexagon.length; i++) {
        const hex = hexagon[i];
        if (hex.team === ENEMY_TEAM && !gameState.aiZonesMovedFromThisTurn.has(hex.zone)) {
            availableZones.add(hex.zone);
        }
    }

    // If no zones are available, no moves can be made.
    if (availableZones.size === 0) {
        return null;
    }

    // Now, iterate through all hexes to find AI units in available zones.
    for (let i = 0; i < hexagon.length; i++) {
        const sourceHex = hexagon[i];
        if (sourceHex.team === ENEMY_TEAM && availableZones.has(sourceHex.zone)) {
            const validMoves = getValidMovesForUnit(i);
            for (const destIndex of validMoves) {
                const score = evaluateMove(i, destIndex);
                if (score > bestMove.score) {
                    bestMove = { from: i, to: destIndex, score: score };
                }
            }

            // If the unit is a cannon, also evaluate setting a threat.
            if (sourceHex.unit === 4) {
                const hexesAtRange1 = getHexesInRange(i, 1);
                const hexesAtRange2 = getHexesInRange(i, 2);
                const potentialTargets = hexesAtRange2.filter(h => !hexesAtRange1.includes(h));

                // To simplify, iterate through all hexes on the board as potential aiming points.
                // A smarter AI would be more selective, but this ensures functionality.
                for (let aimingIndex = 0; aimingIndex < hexagon.length; aimingIndex++) {
                    const targetGroup = _calculateCannonTargetGroup(aimingIndex, potentialTargets);
                    if (targetGroup.length > 0) {
                        const score = evaluateThreatAction(i, targetGroup);
                        if (score > bestMove.score) {
                            bestMove = { from: i, to: -1, score: score, type: 'set_threat', aimingIndex: aimingIndex };
                        }
                    }
                }
            }
        }
    }

    return bestMove.from !== -1 ? bestMove : null;
}

/**
 * Executes a single move for the AI.
 * This function will be used by the new one-move-at-a-time AI logic.
 * @param {{from: number, to: number}} move - The move to execute.
 */
function executeAIMove(move) {
    // Handle the "set threat" action type for cannons by triggering an animation.
    if (move.type === 'set_threat') {
        // Recalculate the target group to ensure it's accurate at the moment of execution.
        const hexesAtRange1 = getHexesInRange(move.from, 1);
        const hexesAtRange2 = getHexesInRange(move.from, 2);
        const potentialTargets = hexesAtRange2.filter(h => !hexesAtRange1.includes(h));
        const targetGroup = _calculateCannonTargetGroup(move.aimingIndex, potentialTargets);

        // Set the animation state instead of directly setting the threat.
        gameState.animateCannonThreat = { cannonIndex: move.from, targetGroup: targetGroup, aimingIndex: move.aimingIndex, duration: 60 }; // 1 second
        gameState.aiZonesMovedFromThisTurn.add(hexagon[move.from].zone);
        return;
    }

    const sourceHex = hexagon[move.from];
    const destinationHex = hexagon[move.to];

    // A check to ensure the destination is empty.
    if (destinationHex.unit !== 0) {
        console.log(`AI move from ${move.from} to ${move.to} is invalid (destination occupied). Skipping.`);
        return;
    }

    if (sounds.move) sounds.move.play();
    gameState.aiZonesMovedFromThisTurn.add(sourceHex.zone);
    destinationHex.unit = sourceHex.unit;
    destinationHex.team = sourceHex.team;
    sourceHex.unit = 0;
    sourceHex.team = 0;
    gameState.animateMovementFrom = move.from;
    gameState.animateMovementTo = move.to;
}

/**
 * Finds and removes all units for the defending team that are surrounded.
 * This is done in two passes to prevent a unit's removal from saving another.
 * @param {number} attackingTeam - The team currently on the offensive.
 */
function resolveSurroundCombat(attackingTeam) {
    const unitsToRemove = [];
    // First pass: identify all units that are surrounded.
    for (let i = 0; i < hexagon.length; i++) {
        if (isSurrounded(i, attackingTeam)) {
            unitsToRemove.push(i);
        }
    }

    // Second pass: remove the units.
    for (const hexIndex of unitsToRemove) {
        hexagon[hexIndex].unit = 0;
        hexagon[hexIndex].team = 0;
        if (sounds.boom2) sounds.boom2.play();
    }
}

// State for the win screen and level transition animation
let zoomOutAnimationState; // Initialized in setup()
// State for the zoom-in animation
let zoomInAnimationState;

/**
 * Pre-calculates the entire board state for the next level.
 * It handles loading from memory if available, or generating a new board if not.
 * @param {number} nextLevel - The level number we are preparing the board for.
 * @param {boolean} [bonusArcher=false] - Whether to grant the player a bonus archer.
 * @returns {{board: Array, targetZone: number}} An object containing the new board state and the target zone for the animation.
 */
function prepareNextLevelBoard(nextLevel, bonusArcher = false) {
    const zoneDominance = calculateZoneDominance();
    const nextLevelBoard = [];
    for (let i = 0; i < hexagon.length; i++) {
        nextLevelBoard[i] = { unit: 0, team: 0 };
    }

    let targetZoneNum;

    if (gameState.levelMemory.has(nextLevel)) {
        // SCENARIO: Returning to a higher level (from a zoom-in).
        // Load the saved outer zones.
        console.log(`Loading saved board state for Level ${nextLevel}.`);
        const savedData = gameState.levelMemory.get(nextLevel);
        targetZoneNum = savedData.excludedZone;
        for (const hexState of savedData.state) {
            nextLevelBoard[hexState.index] = { unit: hexState.unit, team: hexState.team };
        }
        gameState.levelMemory.delete(nextLevel);

        // Populate the target zone (the one we zoomed into) with the results of the lower level.
        populateTargetZone(nextLevelBoard, targetZoneNum, zoneDominance);

    } else {
        // SCENARIO: Advancing to a brand new level.
        // The target zone is always Zone 7.
        targetZoneNum = 7;

        // Populate the target zone with the results of the previous level.
        populateTargetZone(nextLevelBoard, targetZoneNum, zoneDominance);

        // Generate new units for the outer zones.
        populateNewOuterZones(nextLevelBoard, targetZoneNum, nextLevel); // Pass the level we are generating for.
    }

    // --- Handle the bonus archer AFTER the board is generated ---
    if (bonusArcher && gameState.secretArcherZone) {
        const bonusZone = gameState.secretArcherZone;
        const hexIndicesInBonusZone = [];
        for (let i = 0; i < hexagon.length; i++) {
            if (hexagon[i].zone === bonusZone) {
                hexIndicesInBonusZone.push(i);
            }
        }

        if (hexIndicesInBonusZone.length > 0) {
            // Find a suitable hex to place the archer, prioritizing converting a player soldier,
            // then an empty hex, and finally overwriting a random hex as a last resort.
            const playerSoldiers = hexIndicesInBonusZone.filter(i => nextLevelBoard[i].team === PLAYER_TEAM && nextLevelBoard[i].unit === 1);
            const emptyHexes = hexIndicesInBonusZone.filter(i => nextLevelBoard[i].unit === 0);
            let targetHexIndex;

            if (playerSoldiers.length > 0) {
                targetHexIndex = random(playerSoldiers);
                console.log(`Converting player soldier to bonus archer in new Zone ${bonusZone} at hex ${targetHexIndex}.`);
            } else if (emptyHexes.length > 0) {
                targetHexIndex = random(emptyHexes);
                console.log(`Adding new bonus archer to empty hex in new Zone ${bonusZone} at hex ${targetHexIndex}.`);
            } else {
                targetHexIndex = random(hexIndicesInBonusZone);
                console.log(`No empty hexes or player soldiers. Overwriting hex ${targetHexIndex} in new Zone ${bonusZone} with bonus archer.`);
            }
            nextLevelBoard[targetHexIndex].unit = 2; // Archer
            nextLevelBoard[targetHexIndex].team = PLAYER_TEAM;
        }
    }

    // DEBUG: Add a player cannon for testing on the new higher level.
    // _addPlayerCannonForTesting(nextLevelBoard);
    return { board: nextLevelBoard, targetZone: targetZoneNum };
}

/**
 * Prepares the data required for the zoom-out animation.
 * @param {number} targetZone - The zone on the new board that will be revealed.
 * @returns {{centerPos: {x: number, y: number}, map: Map<number, number>}} An object containing the screen-space center of the target zone and the reveal map.
 */
function prepareZoomOutAnimationData(targetZone) {
    const hexesInTargetZone = hexesByZone.get(targetZone);

    // Calculate the screen-space center of the zone we are zooming into.
    const avgX = hexesInTargetZone.reduce((sum, h) => sum + h.xHex, 0) / hexesInTargetZone.length;
    const avgY = hexesInTargetZone.reduce((sum, h) => sum + h.yHex, 0) / hexesInTargetZone.length;
    const centerPos = hexToXY(avgX, avgY);

    // Map the old zones (1-7) to the new hexes they will become in the target zone.
    const revealMap = new Map();
    for (const hex of hexesInTargetZone) {
        const newHexIndex = hexagon.indexOf(hex);
        const oldZoneItRepresents = hex.mapsToNewZone;
        if (oldZoneItRepresents) {
            revealMap.set(oldZoneItRepresents, newHexIndex);
        }
    }
    return { centerPos, revealMap };
}

/**
 * Populates the target zone of a new board based on the dominance results of the previous level.
 * @param {Array<{unit: number, team: number}>} board - The board state array to modify.
 * @param {number} targetZone - The zone number to populate.
 * @param {object} zoneDominance - The pre-calculated dominance results.
 */
function populateTargetZone(board, targetZone, zoneDominance) {
    console.log(`Populating Zone ${targetZone} on the new board.`);
    const hexesInTargetZone = hexesByZone.get(targetZone);
    for (const hex of hexesInTargetZone) {
        const targetHexIndex = hexagon.indexOf(hex);
        const sourceZoneResult = zoneDominance[hex.mapsToNewZone];
        if (sourceZoneResult && sourceZoneResult.team !== 0) {
            board[targetHexIndex].unit = sourceZoneResult.unitType;
            board[targetHexIndex].team = sourceZoneResult.team;
        }
    }
}
/**
 * Populates the outer zones of a given board state with new, randomly generated units.
 * This is used when advancing to a level for the first time.
 * @param {Array<{unit: number, team: number}>} board - The board state array to modify.
 * @param {number | null} excludedZone - The zone number to exclude from random unit conversion.
 * @param {number} levelToGenerate - The level number for which to generate units.
 */
function populateNewOuterZones(board, excludedZone, levelToGenerate) {
    console.log(`Generating new board state for outer zones.`);
    const outerZonePlacements = generateOuterZoneUnits();
    for (const [hexIndex, state] of outerZonePlacements.entries()) {
        board[hexIndex] = { unit: state.unit, team: state.team };
    }
    if (levelToGenerate >= 3) {
        _convertRandomSoldier(board, ENEMY_TEAM, 2, 'archer', excludedZone);
    }
    if (levelToGenerate >= 2) {
        _convertRandomSoldier(board, ENEMY_TEAM, 3, 'cavalry', excludedZone);
    }
    if (levelToGenerate >= 5) {
        _convertRandomSoldier(board, ENEMY_TEAM, 4, 'cannon', excludedZone);
    }
}

function startLevelTransition(bonusArcher = false) {
    // This function kicks off the win animation state machine.
    if (zoomOutAnimationState.phase === 'inactive') {
        // If the player is leaving level 2, mark the cavalry intro as seen
        // so it doesn't appear again if they return to this level.
        if (gameState.level === 2) {
            gameState.hasBeenOnLevel2 = true;
        }
        if (gameState.level === 3) {
            gameState.hasBeenOnLevel3 = true;
        }
        if (gameState.level === 5) {
            gameState.hasBeenOnLevel5 = true;
        }
        // Mark the current level as having had its scout feature opportunity.
        gameState.scoutMessageShownOnLevels.add(gameState.level);

        const nextLevel = gameState.level + 1; // The level we are transitioning TO.
        zoomOutAnimationState.phase = 'shrinking';
        zoomOutAnimationState.progress = 0;
        zoomOutAnimationState.pauseTimer = 0;
        zoomOutAnimationState.revealedZones = 0;
        zoomOutAnimationState.revealTimer = 30; // Initial delay before first reveal
        if (sounds.boom1) sounds.boom1.play();

        // 1. Prepare the next level's board data
        const { board, targetZone } = prepareNextLevelBoard(nextLevel, bonusArcher);
        zoomOutAnimationState.nextLevelBoard = board;

        // 2. Prepare the animation's visual data
        const { centerPos, revealMap } = prepareZoomOutAnimationData(targetZone);
        zoomOutAnimationState.targetZoneForReveal = targetZone;
        zoomOutAnimationState.targetZoneCenterPos = centerPos;
        zoomOutAnimationState.revealMap = revealMap;

        // Save the state immediately after configuring the animation.
        saveGameState();
    }
}

// Callback function for successful sound loading
function soundLoadSuccess(sound) {
    console.log(`Successfully loaded sound: ${sound.file}`);
}

// Callback function for failed sound loading. This prevents the game from getting stuck.
function soundLoadError(err) {
    // The 'err' object is often the browser's Event object for the error.
    // This message provides a more helpful hint about the likely cause.
    console.error("A sound file failed to load. This is likely a CORS security block. Please ensure you are accessing the game via the http://127.0.0.1:5500 URL from Live Server, not by opening the HTML file directly.", err);
}

// This function runs before setup() and ensures all assets are loaded before the game starts.
function preload() {
    // To make this work, you need to create an 'assets/sounds' folder
    // in the same directory as your index.html file, and place your
    // sound files there. I'm using placeholder names.
    // You can find free sounds at sites like freesound.org.
    sounds.boom1 = loadSound('assets/sounds/boom1.wav', soundLoadSuccess, soundLoadError);
    sounds.boom2 = loadSound('assets/sounds/boom2.wav', soundLoadSuccess, soundLoadError);
    sounds.select = loadSound('assets/sounds/select.wav', soundLoadSuccess, soundLoadError);
    sounds.selectEnemy = loadSound('assets/sounds/select_enemy.wav', soundLoadSuccess, soundLoadError);
    sounds.error = loadSound('assets/sounds/error.wav', soundLoadSuccess, soundLoadError);
    sounds.move = loadSound('assets/sounds/move.wav', soundLoadSuccess, soundLoadError);
}

/**
 * Updates the layout of the game based on the current window size.
 * This function calculates a dynamic scale for the board and repositions/resizes all UI elements.
 * It acts as a single source of truth for our responsive design.
 */
function updateLayout() {
    // Calculate a scale that fits the board (approx 450x450 internal units)
    // comfortably within the window, leaving some margin for UI.
    // We use the smaller of the two dimensions to ensure it always fits.
    boardScale = min(width / 550, height / 550);

    const mainButtonRadius = 36 * boardScale;
    const buttonSpacing = 20 * boardScale;
    const edgeMargin = 80 * boardScale; // Use a responsive margin

    // --- Re-initialize all UI buttons with new positions and sizes ---

    // Game Screen Buttons
    endTurnButton = new Button(width - edgeMargin, height - edgeMargin, mainButtonRadius, "End", "Turn");
    debugSkipLevelButton = new Button(endTurnButton.x, endTurnButton.y - mainButtonRadius * 2 - buttonSpacing, mainButtonRadius, "Skip to", "Level 5"); // DEBUG
    zoomOutButton = new Button(edgeMargin, edgeMargin, mainButtonRadius, "Zoom", "Out", 'out');
    zoomInButton = new Button(edgeMargin, edgeMargin + mainButtonRadius * 2 + buttonSpacing, mainButtonRadius, "Zoom", "In", 'in');

    // Intro and Instructions Screen Buttons. Renamed for clarity.
    newGameButton = new Button(width - edgeMargin, height - edgeMargin, mainButtonRadius, "New Game", null);
    startButton = new Button(width - edgeMargin, height - edgeMargin, mainButtonRadius, "Start", null);

    // Difficulty adjustment buttons for the intro screen
    const difficultyButtonRadius = 20 * boardScale;
    // Position the difficulty selector on the left side of the screen, at the bottom.
    // The UI's X coordinate is its center. We need to offset it from the left edge
    // to make room for the "Set Difficulty:" text. This value is chosen to prevent
    // overlap with the "Start" button on the right, especially on narrower screens.
    const difficultyUiX = 200 * boardScale;
    const difficultyUiY = height - edgeMargin; // Vertically align with start button
    upArrowButton = new Button(difficultyUiX, difficultyUiY - (35 * boardScale), difficultyButtonRadius, "", null); // Position above center
    downArrowButton = new Button(difficultyUiX, difficultyUiY + (35 * boardScale), difficultyButtonRadius, "", null); // Position below center

    // --- Pre-calculate layout values for the "Moves Left" UI ---
    // These values are used in `drawAvailableMovesUI` and only need to be
    // calculated when the screen size changes, not on every frame.
    const baseRadius = 18.75;
    const baseBorderWidth = 2;
    const baseTitleSize = 20;
    const baseTitleYOffset = -65;
    const baseUiXOffset = 80;
    const baseUiYOffset = 80;

    uiLayout.dotRadius = baseRadius * boardScale;
    uiLayout.borderWidth = baseBorderWidth * boardScale;
    uiLayout.titleSize = baseTitleSize * boardScale;
    uiLayout.titleYOffset = baseTitleYOffset * boardScale;
    uiLayout.baseX = -width / 2 + (baseUiXOffset * boardScale);
    uiLayout.baseY = height / 2 - (baseUiYOffset * boardScale);
    uiLayout.spacing = uiLayout.dotRadius * sqrt(3);
}

// p5.js setup function - runs once at the beginning
function setup() {
    createCanvas(windowWidth, windowHeight);

    // The loadGameState() call is commented out to prevent the game from
    // automatically loading a saved state. This ensures you always start
    // from the intro screen.
    // loadGameState();

    // --- Pre-calculate hexagon lookups by zone for efficiency ---
    for (let i = 1; i <= 7; i++) {
        hexesByZone.set(i, []);
    }
    for (let i = 0; i < hexagon.length; i++) {
        hexesByZone.get(hexagon[i].zone).push(hexagon[i]);
    }
    precalculateHexRanges(); // One-time calculation for performance
    precalculateCoordMap();

    // Initialize colors (must be done in setup or draw in p5.js)
    zoneColor = [
        color(255, 0, 0), //dummy color
        color(235, 171, 203), //zone 1
        color(230, 147, 166),
        color(102, 208, 237),
        color(149, 255, 0),
        color(227, 176, 66),
        color(81, 191, 67),
        color(232, 42, 229)
    ];

    // Adjust sound volumes for better balance.
    // The "boom" sounds are loud, so they are reduced to make other sounds audible.
    if (sounds.boom1) sounds.boom1.setVolume(0.5);
    if (sounds.boom2) sounds.boom2.setVolume(0.5);
    if (sounds.select) sounds.select.setVolume(1.0);
    if (sounds.selectEnemy) sounds.selectEnemy.setVolume(1.0);
    if (sounds.error) sounds.error.setVolume(0.7);
    if (sounds.move) sounds.move.setVolume(0.8);

    teamColors = [
        {mainColor: color(245, 8, 8), secondaryColor: color(47, 0, 255)}, //dummy
        {mainColor: color(8, 8, 8), secondaryColor: color(232, 225, 225)}, //player1
        {mainColor: color(161, 3, 3), secondaryColor: color(7, 176, 100)}  //player2(or AI)
    ];

    // Initialize the zoom-out animation state machine
    zoomOutAnimationState = {
        phase: 'inactive', // inactive, shrinking, paused, revealing, recoloring_pause, final_reveal, complete
        progress: 0, // For the shrinking/moving animation
        targetZoneForReveal: 7, // The zone on the new board being revealed
        revealMap: new Map(), // Maps old zone number -> new hex index
        targetZoneCenterPos: { x: 0, y: 0 }, // The screen-space coordinates for the center of the target zone
        pauseTimer: 0,
        revealTimer: 0, // For revealing Zone 7 hexes one by one
        revealedZones: 0, // How many of the 7 zones have been revealed
        zoneRevealOrder: [1, 2, 3, 4, 5, 6, 7], // The order to reveal zones
        nextLevelBoard: null // Stores the pre-calculated state of the next level's board
    };
    zoomInAnimationState = { 
        phase: 'inactive', // inactive, fading_out, expanding, recoloring, revealing, finalizing, complete 
        sourceZone: null,
        progress: 0,
        startPos: { x: 0, y: 0 },
        precalculatedBoard: null,
        recolorTimer: 0,
        recoloredHexes: 0,
        // The order to recolor the 7 hexes of the expanded zone
        recolorOrder: [] 
    };

    // Calculate the initial layout for all UI elements
    updateLayout();
}

/**
 * p5.js function that is automatically called when the browser window is resized.
 */
function windowResized() {
    // 1. Resize the canvas to the new window dimensions.
    resizeCanvas(windowWidth, windowHeight);
    // 2. Recalculate the scale and reposition/resize all UI elements.
    updateLayout();
}

/**
 * Draws the entire intro screen, including the title, difficulty selector,
 * and instructions.
 */
function drawIntroScreen() {
    push();
    translate(width / 2, height / 2);

    textAlign(CENTER, CENTER);

    // Define base sizes and scale them for a consistent, responsive look
    const titleBaseSize = 120;
    const subtitleBaseSize = 55;
    const instructionBaseSize = 22;

    // Main Title: "Zoom:"
    fill(170, 0, 120);
    textStyle(BOLD);
    textSize(titleBaseSize * boardScale);
    text("Zoom:", 0, -height * 0.35); // Y position remains relative to height for centering
    textStyle(NORMAL); // Reset style for the subtitle
    fill(0); // Reset fill to black for the subtitle

    // Subtitle: "Battle for the Multiverse"
    const subtitleSize = subtitleBaseSize * boardScale;
    const subtitleLineHeight = subtitleSize * 1.1; // Use relative line height
    textSize(subtitleSize);
    text("Battle for the", 0, -height * 0.21);
    text("Multiverse", 0, -height * 0.21 + subtitleLineHeight);

    // Difficulty UI
    const upArrowRelativeX = upArrowButton.x - (width / 2);
    const upArrowRelativeY = upArrowButton.y - (height / 2);
    const downArrowRelativeY = downArrowButton.y - (height / 2);

    // --- Calculate text widths first for consistent spacing ---
    const difficultyNumberText = String(gameState.introScreenDifficulty);
    textSize(22 * boardScale); // Set size for the number to measure it
    const numberWidth = textWidth(difficultyNumberText);
    const spacing = 8 * boardScale; // A consistent spacing value
    const difficultyNumberX = upArrowRelativeX;
    const difficultyNumberY = (upArrowRelativeY + downArrowRelativeY) / 2;

    // --- Draw "Set Difficulty:" text ---
    fill(0);
    textSize(22 * boardScale);
    textAlign(RIGHT, CENTER);
    // Position it to the left of the number's bounding box
    text("Set Difficulty:", difficultyNumberX - (numberWidth / 2) - spacing, difficultyNumberY);

    // --- Draw the difficulty number ---
    textAlign(CENTER, CENTER);
    textSize(22 * boardScale);
    text(difficultyNumberText, difficultyNumberX, difficultyNumberY);

    // --- Draw the difficulty label ---
    const label = DIFFICULTY_LABELS[gameState.introScreenDifficulty];
    if (label) {
        fill(80);
        textSize(22 * boardScale);
        textAlign(LEFT, CENTER);
        // Position it to the right of the number's bounding box
        text(label, difficultyNumberX + (numberWidth / 2) + spacing, difficultyNumberY);
    }

    // Draw arrow buttons (they are drawn relative to center inside their own method)
    upArrowButton.draw(true);
    downArrowButton.draw(true);

    // Manually draw solid triangles for arrows, as these buttons are simple circles
    const arrowSize = 10 * boardScale;
    const arrowColor = color(50);
    fill(arrowColor);
    noStroke();
    triangle(difficultyNumberX, upArrowRelativeY - arrowSize,
             difficultyNumberX - arrowSize, upArrowRelativeY + arrowSize,
             difficultyNumberX + arrowSize, upArrowRelativeY + arrowSize);

    triangle(difficultyNumberX, downArrowRelativeY + arrowSize,
             difficultyNumberX - arrowSize, downArrowRelativeY - arrowSize,
             difficultyNumberX + arrowSize, downArrowRelativeY - arrowSize);

    // New Game Button
    newGameButton.draw(true); // Always active on intro screen
    pop();
}

/**
 * Draws the instructions screen, which appears after the intro screen.
 */
function drawInstructionsScreen() {
    push();
    translate(width / 2, height / 2);

    // Title
    textAlign(CENTER, CENTER);
    fill(0);
    textStyle(BOLD);
    textSize(50 * boardScale);
    text("How to Play", 0, -height * 0.35);
    textStyle(NORMAL);

    // Instructions Text
    fill(50);
    textAlign(LEFT, TOP);
    const instructionSize = 18 * boardScale;
    textSize(instructionSize);
    const instructionWidth = width * 0.8;
    const instructionX = -instructionWidth / 2;
    const instructionY = -height * 0.3;

    const instructions = `Take over the multiverse by working your way through levels and eliminating the enemies on the dreaded level seventeen.

Engage an enemy with three units to eliminate them. Or occupy five hexes in one color zone to eliminate enemies in that zone.

When no enemies remain on a level, you will Zoom Out to the next level. Color zones with a 2-unit advantage are controlled. They generate a soldier in the corresponding hex on the next level. If you have a special unit, it will only carry over to the next level if it is in a zone you control.

When noted, Zooming Out early will gain a reward.

Zooming In allows you an opportunity to improve (or worsen!) your standing in a zone of your choosing.`;
    text(instructions, instructionX, instructionY, instructionWidth);

    // Start Button
    startButton.draw(true);
    pop();
}

/**
 * Handles the visual-only part of the zoom-out animation. It draws the
 * shrinking board or the hybrid view of the old and new boards based on the
 * current animation phase.
 */
function drawZoomOutAnimationVisuals() {
    const TARGET_ROTATION = PI / 9;
    const TARGET_EXPANSION = 1 / 3;

    if (zoomOutAnimationState.phase === 'shrinking') {
        push();
        const progress = zoomOutAnimationState.progress;
        const currentRotation = lerp(0, TARGET_ROTATION, progress);
        const currentExpansion = lerp(1, TARGET_EXPANSION, progress);
        const currentX = lerp(0, zoomOutAnimationState.targetZoneCenterPos.x, progress);
        const currentY = lerp(0, zoomOutAnimationState.targetZoneCenterPos.y, progress);

        translate(currentX, currentY);
        rotate(currentRotation);
        scale(currentExpansion);
        drawGameBoard();
        drawAllUnits();
        pop();
    } else { // paused, revealing, or finalizing
        // Draw the hybrid view: shrunken old board and full-scale new board
        // Draw shrunken old board (with disappearing zones)
        push();
        translate(zoomOutAnimationState.targetZoneCenterPos.x, zoomOutAnimationState.targetZoneCenterPos.y);
        rotate(TARGET_ROTATION);
        scale(TARGET_EXPANSION);
        for (let i = 0; i < hexagon.length; i++) {
            const hex = hexagon[i];
            const oldZone = hex.zone;
            const revealStepOfOldZone = zoomOutAnimationState.zoneRevealOrder.indexOf(oldZone);
            // Only draw hexes from old zones that have not yet been "revealed" (i.e., replaced).
            if (revealStepOfOldZone >= zoomOutAnimationState.revealedZones) {
                hex.draw(i);
                drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team);
            }
        }
        pop();

        drawTransitionBoard(); // Draw the appearing parts of the new board
    }
}

/**
 * Updates the state of the zoom-out animation for the next frame.
 * This function contains the state machine logic that transitions the
 * animation from one phase to the next.
 */
function updateZoomOutAnimationState() {
    // This function will eventually contain the entire switch statement.
    // For now, it handles the initial phases.
    switch (zoomOutAnimationState.phase) {
        case 'shrinking':
            const shrinkDuration = 60; // 1 second at 60fps
            zoomOutAnimationState.progress += 1 / shrinkDuration;
            if (zoomOutAnimationState.progress >= 1) {
                zoomOutAnimationState.progress = 1;
                zoomOutAnimationState.phase = 'paused';
                zoomOutAnimationState.pauseTimer = 30;
            }
            break;
        case 'paused':
            zoomOutAnimationState.pauseTimer--;
            if (zoomOutAnimationState.pauseTimer <= 0) {
                zoomOutAnimationState.phase = 'revealing';
                zoomOutAnimationState.revealTimer = 30; // Time until first reveal
            }
            break;
        case 'revealing':
            zoomOutAnimationState.revealTimer--;
            if (zoomOutAnimationState.revealTimer <= 0) {
                if (zoomOutAnimationState.revealedZones < 7) {
                    const zoneToReveal = zoomOutAnimationState.zoneRevealOrder[zoomOutAnimationState.revealedZones];
                    const newHexIndex = zoomOutAnimationState.revealMap.get(zoneToReveal);
                    if (newHexIndex !== undefined) { // Safety check
                        const newUnitPresent = zoomOutAnimationState.nextLevelBoard[newHexIndex].unit !== 0;
                        if (newUnitPresent && sounds.select) sounds.select.play();
                    }
                    zoomOutAnimationState.revealedZones++;
                    zoomOutAnimationState.revealTimer = 30; // Reset timer for next reveal
                } else {
                    zoomOutAnimationState.phase = 'recoloring_pause';
                    zoomOutAnimationState.revealTimer = 30; // "one more beat"
                }
            }
            break;
        case 'recoloring_pause':
            zoomOutAnimationState.revealTimer--;
            if (zoomOutAnimationState.revealTimer <= 0) {
                // Pause is over. The next draw will use the new colors.
                // TODO: Maybe play a sound for the recolor.
                zoomOutAnimationState.phase = 'final_reveal';
                zoomOutAnimationState.revealTimer = 30; // Beat before outer zones appear.
            }
            break;
        case 'final_reveal':
            zoomOutAnimationState.revealTimer--;
            if (zoomOutAnimationState.revealTimer <= 0) {
                // Final pause is over. The next draw will show the outer zones.
                // Permanently update the game board state now.
                for (let i = 0; i < hexagon.length; i++) {
                    hexagon[i].unit = zoomOutAnimationState.nextLevelBoard[i].unit;
                    hexagon[i].team = zoomOutAnimationState.nextLevelBoard[i].team;
                }
                if (sounds.boom2) sounds.boom2.play();
                zoomOutAnimationState.phase = 'complete';
                zoomOutAnimationState.revealTimer = 60; // Show final board for 1 second.
            }
            break;
        case 'complete':
            zoomOutAnimationState.revealTimer--;
            if (zoomOutAnimationState.revealTimer <= 0) {
                // Final pause is over. Reset for the next level.
                const nextLevel = gameState.level + 1;
                gameState = { ...gameState, selected: -1, badClick: 0, zonesMovedFromThisTurn: new Set(), endTurn: 0, isPlayerTurn: true, aiMoveQueue: [], aiZonesMovedFromThisTurn: new Set(), animationLoop: 0, animateMovementFrom: null, animateMovementTo: null, level: nextLevel, playerTurnCount: 1, secretArcherZone: floor(random(6)) + 1, cannonsFiredThisTurn: new Set(), cannonThreats: new Map(), animateCannonThreat: null };
                gameState.introScreenDifficulty = DIFFICULTY; // Sync intro screen difficulty with current game difficulty
                zoomOutAnimationState.phase = 'inactive';
            }
            break;
    }
}

/**
 * Draws all the UI elements for the main game screen, such as buttons,
 * level information, and status messages. This is only called when no
 * major animations are active.
 */
function drawGameUI() {
    push();
    translate(width / 2, height / 2);

    // Draw the Zoom Out button, activating it only if the player can use it.
    const canZoomOut = gameState.isPlayerTurn && gameState.zonesMovedFromThisTurn.size <= 3 && gameState.level < LEVEL_NAMES.length;
    const canZoomIn = gameState.isPlayerTurn && gameState.level > 1 && gameState.zonesMovedFromThisTurn.size === 0;
    zoomOutButton.draw(canZoomOut);
    zoomInButton.draw(canZoomIn, gameState.zoneSelectionMode);

    // Draw Level Number and Name (positioned to the right of Zoom Out button)
    const levelTextSize = 48; // Increased from 24
    fill(0); // Black text
    textSize(levelTextSize);
    textAlign(LEFT, TOP); // Align text to top-left
    const levelDisplayX = (zoomOutButton.x + zoomOutButton.radius) - width / 2 + 40; // Position to the right of the button, with more padding
    const levelLineSpacing = levelTextSize * 1.05; // Use a responsive line spacing slightly larger than the text
    // Calculate the Y position to vertically center the two-line text block with the button.
    const buttonCenterY = zoomOutButton.y - height / 2;
    const textBlockCenterOffset = (levelTextSize + levelLineSpacing) / 2; // (height of line 1 + spacing to line 2) / 2
    const levelDisplayY = buttonCenterY - textBlockCenterOffset;
    text(`Level ${gameState.level}:`, levelDisplayX, levelDisplayY); // First line
    text(LEVEL_NAMES[gameState.level - 1], levelDisplayX, levelDisplayY + levelLineSpacing); // Second line, with responsive spacing

    // Draw turn-specific UI for the player
    if (gameState.isPlayerTurn) {
        endTurnButton.draw(gameState.zonesMovedFromThisTurn.size > 0 || gameState.endTurn === 1); // Pass active state
        debugSkipLevelButton.draw(true); // DEBUG
        drawScoutMessage();
        showStatusMessage();
    }

    // These messages are informational and should be visible on both turns.
    drawCavalryMessage();
    drawArcherMessage();
    drawCannonMessage();
    drawZoomOutTargetMessage();

    // Draw the "Moves Left" UI for both player and AI
    drawAvailableMovesUI();
    pop();
}

/**
 * Handles the AI's turn progression. This function checks if it's the AI's
 * turn and if no other animations are playing, then executes the next move
 * from the AI's pre-calculated queue.
 */
function handleAITurn() {
    // Only run AI logic if it's the AI's turn AND no major animations are running.
    if (gameState.isPlayerTurn || zoomOutAnimationState.phase !== 'inactive' || zoomInAnimationState.phase !== 'inactive') {
        return;
    }

    // If no movement or cannon animation is playing, decide the next AI action.
    if (gameState.animateMovementTo === null && gameState.animateCannonThreat === null) {
        const bestMove = findBestAIMove();

        // Condition to end the turn: No move is possible, OR it's not the first move and the best move isn't beneficial (score <= 0).
        const shouldEndTurn = !bestMove || (gameState.aiMovesMadeThisTurn > 0 && bestMove.score <= 0);

        if (shouldEndTurn) {
            // End the AI's turn.
            gameState.isPlayerTurn = true;
            gameState.secretArcherZone = floor(random(6)) + 1; // New secret zone for player
        } else {
            // Execute the move.
            executeAIMove(bestMove);
            gameState.aiMovesMadeThisTurn++;
        }
    }
}

/**
 * Checks for the win condition (no enemy units left) and handles the outcome,
 * either by triggering the final win screen or starting the transition to the next level.
 * This is pure game logic and does not involve drawing.
 */
function checkAndHandleWinCondition() {
    // Don't check for win conditions if an animation is playing, the game is already won, or it's the first frame.
    if (zoomOutAnimationState.phase !== 'inactive' || gameState.gameWon || frameCount <= 1) {
        return;
    }

    const enemyUnitCount = hexagon.filter(h => h.team === ENEMY_TEAM).length;
    if (enemyUnitCount === 0) {
        if (gameState.level === LEVEL_NAMES.length) {
            gameState.gameWon = true; // Set the final win state
            if (sounds.boom1) sounds.boom1.play();
        } else {
            startLevelTransition(false); // No bonus for automatic win
        }
    }
}

/**
 * Draws the final win screen. This includes the slowly rotating game board
 * in the background and the "You Win!" text overlaid on top.
 */
function drawFinalWinScreen() {
    // 1. Update rotation state
    const rotationPerFrame = TWO_PI / (30 * 60);
    gameState.winRotation += rotationPerFrame;

    // 2. Apply rotation to the entire canvas
    push(); // Save the current drawing state
    translate(width / 2, height / 2);
    rotate(gameState.winRotation);
    translate(-width / 2, -height / 2);

    // 3. Draw the game board underneath, scaled and centered
    push();
    translate(width / 2, height / 2);
    scale(boardScale);
    drawGameBoard();
    drawAllUnits();
    pop();

    // 4. Draw the "You Win!" text on top
    // Draw "You" in the upper left
    fill(170, 0, 120); // Same color as "Zoom:" title
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(200 * boardScale);
    text("You", 50 * boardScale, 50 * boardScale);
    textAlign(RIGHT, BOTTOM);
    text("Win!", width - (50 * boardScale), height - (50 * boardScale));
    textStyle(NORMAL); // Reset text style

    // 5. Restore the drawing state from the rotation
    pop();
}

/**
 * Draws the flashing animation for an AI cannon setting a threat.
 * This function also handles the state transition after the animation completes,
 * setting the permanent threat on the board.
 */
function drawCannonThreatAnimation() {
    if (!gameState.animateCannonThreat) {
        return;
    }

    const { cannonIndex, targetGroup, duration, aimingIndex } = gameState.animateCannonThreat;

    // Create a flashing effect by only drawing the highlight on certain frames.
    // This will flash on for 10 frames, off for 10, etc.
    if (floor(duration / 10) % 2 === 1) {
        const cannonHex = hexagon[cannonIndex];
        const cannonPos = hexToXY(cannonHex.xHex, cannonHex.yHex);

        // Highlight the cannon itself
        fill(255, 0, 0, 180); // Semi-transparent red
        stroke(255, 255, 0); // Yellow border
        strokeWeight(4);
        drawMiniHexagon(cannonPos.x, cannonPos.y, r);

        // Highlight the target hexes
        for (const hexIndex of targetGroup) {
            const hex = hexagon[hexIndex];
            const pos = hexToXY(hex.xHex, hex.yHex);
            drawMiniHexagon(pos.x, pos.y, r);
        }
    }

    // Decrement the timer.
    gameState.animateCannonThreat.duration--;

    // When the animation is over, set the permanent threat.
    if (gameState.animateCannonThreat.duration <= 0) {
        const cannonHex = hexagon[cannonIndex];
        const aimingHex = hexagon[aimingIndex];
        const relativeAim = { dx: aimingHex.xHex - cannonHex.xHex, dy: aimingHex.yHex - cannonHex.yHex };
        gameState.cannonThreats.set(cannonIndex, { threatenedHexes: targetGroup, relativeAim: relativeAim });
        if (sounds.boom2) sounds.boom2.play();
        gameState.animateCannonThreat = null; // End the animation
    }
}

/**
 * Draws the main game screen when the game is in progress.
 * This function is the main dispatcher for the active game state, handling
 * animations, board drawing, and UI rendering.
 */
function drawMainGame() {
    // --- Normal Game Loop (not won) ---
    push();
    translate(width / 2, height / 2);
    scale(boardScale);

    checkAndHandleWinCondition();

    if (zoomOutAnimationState.phase !== 'inactive') {
        drawZoomOutAnimationVisuals();
        updateZoomOutAnimationState();

    } else if (zoomInAnimationState.phase !== 'inactive') {
        drawZoomInAnimation();
    } else {
        drawGameBoard();
        drawAllUnits();
        drawCannonTargetingUI();
        drawCannonThreatAnimation();
        drawAnimation();
    }
    pop();

    // --- UI Layer for Game ---
    if (zoomOutAnimationState.phase === 'inactive' && zoomInAnimationState.phase === 'inactive' && !gameState.gameWon) {
        drawGameUI();
    }
    handleAITurn();
}



// draws board, color circles, coordinates, soldiers, (error)messages
function draw() {
    background(247, 242, 242);

    if (gameState.currentScreen === 'intro') {
        // --- Intro Screen (drawn relative to screen center) ---
        drawIntroScreen();
    } else if (gameState.currentScreen === 'instructions') {
        // --- Instructions Screen ---
        drawInstructionsScreen();
    } else if (gameState.currentScreen === 'game') {
        // --- Main Game Screen ---

        // If the game is won, apply a continuous rotation to the entire scene.
        // This needs to wrap all the game screen drawing elements.
        if (gameState.gameWon) {
            drawFinalWinScreen();
        } else {
            drawMainGame();
        }
    }
}

/**
 * Custom drawing function for the level transition animation.
 * It draws a hybrid board, showing parts of the old level disappearing
 * while parts of the new level appear.
 */
function drawTransitionBoard() { // Note: This is now only for the NEW board parts
    // Determine if we should use the old zone colors for the new hexes.
    // This is true during the reveal and the subsequent pause before recoloring.
    const useOldColors = (zoomOutAnimationState.phase === 'revealing' || zoomOutAnimationState.phase === 'recoloring_pause');

    // Draw the newly revealed hexes from Zone 7
    for (let i = 0; i < zoomOutAnimationState.revealedZones; i++) {
        const oldZoneNumber = zoomOutAnimationState.zoneRevealOrder[i];
        const newHexIndex = zoomOutAnimationState.revealMap.get(oldZoneNumber);

        if (newHexIndex === undefined) continue; // Safety check in case the map is missing an entry

        const newHex = hexagon[newHexIndex];
        const newHexState = zoomOutAnimationState.nextLevelBoard[newHexIndex];

        // Choose color based on the animation phase
        const hexColor = useOldColors ? zoneColor[oldZoneNumber] : zoneColor[zoomOutAnimationState.targetZoneForReveal];

        newHex.draw(newHexIndex, hexColor);
        drawUnit(newHex.xHex, newHex.yHex, newHexState.unit, newHexState.team);
    }

    // The final reveal of outer zones happens once the 'complete' phase begins.
    const showOuterZones = (zoomOutAnimationState.phase === 'complete');

    if (showOuterZones) {
        for (let i = 0; i < hexagon.length; i++) {
            if (hexagon[i].zone !== zoomOutAnimationState.targetZoneForReveal) {
                const hex = hexagon[i];
                // The outer zones use their own default colors, so no override is needed.
                hex.draw(i, null);
                drawUnit(hex.xHex, hex.yHex, zoomOutAnimationState.nextLevelBoard[i].unit, zoomOutAnimationState.nextLevelBoard[i].team);
            }
        }
    }
}

/**
 * Custom drawing function for the zoom-in animation.
 * It fades out non-selected zones, then expands and centers the selected zone.
 */
function drawZoomInAnimation() {
    // 1. State Update
    const fadeDuration = 30; // 0.5s
    const expandDuration = 60; // 1s

    if (zoomInAnimationState.phase === 'fading_out') {
        zoomInAnimationState.progress += 1 / fadeDuration;
        if (zoomInAnimationState.progress >= 1) {
            zoomInAnimationState.progress = 0;
            zoomInAnimationState.phase = 'expanding';
        }
    } else if (zoomInAnimationState.phase === 'expanding') {
        zoomInAnimationState.progress += 1 / expandDuration;
        if (zoomInAnimationState.progress >= 1) {
            zoomInAnimationState.progress = 1;
            zoomInAnimationState.phase = 'recoloring';
            zoomInAnimationState.recolorTimer = 30; // Wait ~0.5s before starting the recolor
        }
    } else if (zoomInAnimationState.phase === 'recoloring') {
        zoomInAnimationState.recolorTimer--;
        if (zoomInAnimationState.recolorTimer <= 0 && zoomInAnimationState.recoloredHexes < 7) {
            zoomInAnimationState.recoloredHexes++;
            zoomInAnimationState.recolorTimer = 30; // ~0.5 second delay at 60fps
            if (sounds.select) sounds.select.play();
        } else if (zoomInAnimationState.recoloredHexes >= 7 && zoomInAnimationState.recolorTimer <= 0) {
            // Transition to the next phase after a short pause
            zoomInAnimationState.phase = 'revealing';
            zoomInAnimationState.recoloredHexes = 0; // Reuse this counter for the reveal
            zoomInAnimationState.recolorTimer = 30; // Initial pause before first reveal
        }
    } else if (zoomInAnimationState.phase === 'revealing') {
        zoomInAnimationState.recolorTimer--;
        if (zoomInAnimationState.recolorTimer <= 0 && zoomInAnimationState.recoloredHexes < 7) {
            zoomInAnimationState.recoloredHexes++; // This now means "revealed new zones"
            zoomInAnimationState.recolorTimer = 15; // A shorter delay between each zone reveal
            if (sounds.boom2) sounds.boom2.play();
        } else if (zoomInAnimationState.recoloredHexes >= 7 && zoomInAnimationState.recolorTimer <= 0) {
            // All new zones are revealed. Transition to the final step.
            zoomInAnimationState.phase = 'finalizing';
            zoomInAnimationState.recolorTimer = 60; // Pause to show the full new board
        }
    } else if (zoomInAnimationState.phase === 'finalizing') {
        zoomInAnimationState.recolorTimer--;
        if (zoomInAnimationState.recolorTimer <= 0) {
            // --- The animation is complete. Now, permanently update the game state. ---
            if (sounds.boom2) sounds.boom2.play();

            // If the player is leaving level 3, mark the archer intro as seen
            if (gameState.level === 3) {
                gameState.hasBeenOnLevel3 = true;
            }
            if (gameState.level === 5) {
                gameState.hasBeenOnLevel5 = true;
            }


            // If the player is leaving level 2, mark the cavalry intro as seen
            // so it doesn't appear again if they return to this level.
            if (gameState.level === 2) {
                gameState.hasBeenOnLevel2 = true;
            }

            // Mark the higher level as having had its scout feature opportunity before descending.
            gameState.scoutMessageShownOnLevels.add(gameState.level);

            // 1. Save the current (higher) level's state BEFORE descending.
            saveOuterZoneState(gameState.level, zoomInAnimationState.sourceZone);

            // 2. Apply the pre-calculated board state for the new level to the main hexagon array.
            for (let i = 0; i < hexagon.length; i++) {
                hexagon[i].unit = zoomInAnimationState.precalculatedBoard[i].unit;
                hexagon[i].team = zoomInAnimationState.precalculatedBoard[i].team;
            }

            // 3. Reset game state for the new, lower level.
            const nextLevel = gameState.level - 1;
            gameState = { ...gameState, selected: -1, badClick: 0, zonesMovedFromThisTurn: new Set(), endTurn: 0, isPlayerTurn: true, aiMoveQueue: [], aiZonesMovedFromThisTurn: new Set(), animationLoop: 0, animateMovementFrom: null, animateMovementTo: null, level: nextLevel, playerTurnCount: 1, secretArcherZone: floor(random(6)) + 1, zoneSelectionMode: false, selectedZone: null, cannonsFiredThisTurn: new Set(), cannonThreats: new Map(), animateCannonThreat: null };
            zoomInAnimationState.phase = 'inactive'; // Reset the animation state machine
        }
    }

    // 2. Drawing
    if (zoomInAnimationState.phase === 'fading_out') {
        for (let i = 0; i < hexagon.length; i++) {
            const hex = hexagon[i];
            let hexColor = zoneColor[hex.zone];
            let unitIsVisible = true;

            if (hex.zone !== zoomInAnimationState.sourceZone) {
                hexColor = lerpColor(hexColor, color(247, 242, 242), zoomInAnimationState.progress);
                if (zoomInAnimationState.progress > 0.5) unitIsVisible = false;
            }
            hex.draw(i, hexColor);
            if (hex.unit > 0 && unitIsVisible) {
                drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team);
            }
        }
    } else if (zoomInAnimationState.phase === 'expanding') {
        const sourceHexes = hexesByZone.get(zoomInAnimationState.sourceZone);
        const currentX = lerp(zoomInAnimationState.startPos.x, 0, zoomInAnimationState.progress);
        const currentY = lerp(zoomInAnimationState.startPos.y, 0, zoomInAnimationState.progress);
        const currentScale = lerp(1, 3, zoomInAnimationState.progress);
        const currentRotation = lerp(0, -PI / 9, zoomInAnimationState.progress);

        push();
        translate(currentX, currentY);
        rotate(currentRotation);
        scale(currentScale);
        translate(-zoomInAnimationState.startPos.x, -zoomInAnimationState.startPos.y);
        for (const hex of sourceHexes) {
            hex.draw(hexagon.indexOf(hex));
            drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team);
        }
        pop();
    } else if (zoomInAnimationState.phase === 'recoloring') {
        // This phase will draw the fully expanded zone and change hex colors one by one.
        // Draw the zone fully expanded and centered
        push();
        translate(0, 0); // Centered
        rotate(-PI / 9); // Final rotation
        scale(3); // Final scale
        translate(-zoomInAnimationState.startPos.x, -zoomInAnimationState.startPos.y);

        // This logic is more robust. It loops through the source hexes directly,
        // ensuring that something is always drawn, even if the recolorOrder is missing.
        const sourceHexes = hexesByZone.get(zoomInAnimationState.sourceZone);
        for (const hex of sourceHexes) {
            const hexIndex = hexagon.indexOf(hex);
            // Find the corresponding recolor instruction for this hex.
            const item = zoomInAnimationState.recolorOrder.find(order => order.hexIndex === hexIndex);
            const itemIndex = item ? zoomInAnimationState.recolorOrder.indexOf(item) : -1;

            let hexColor;
            if (item && itemIndex < zoomInAnimationState.recoloredHexes) {
                // This hex has been recolored
                hexColor = zoneColor[item.newZone];
            } else {
                // This hex has not been recolored yet, use the original source zone color
                hexColor = zoneColor[zoomInAnimationState.sourceZone];
            }
            hex.draw(hexIndex, hexColor);
            drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team);
        }
        pop();
    } else if (zoomInAnimationState.phase === 'revealing') {
        // This phase draws a hybrid board: old hexes disappear as new zones appear.

        // --- Draw the remaining old hexes ---
        push();
        translate(0, 0);
        rotate(-PI / 9);
        scale(3);
        translate(-zoomInAnimationState.startPos.x, -zoomInAnimationState.startPos.y);

        const sourceHexes = hexesByZone.get(zoomInAnimationState.sourceZone);
        for (const hex of sourceHexes) {
            const item = zoomInAnimationState.recolorOrder.find(order => order.hexIndex === hexagon.indexOf(hex));
            if (item) {
                const itemIndex = zoomInAnimationState.recolorOrder.indexOf(item);
                // Only draw the old hex if its corresponding new zone has NOT been revealed yet.
                if (itemIndex >= zoomInAnimationState.recoloredHexes) {
                    const hexColor = zoneColor[item.newZone];
                    hex.draw(item.hexIndex, hexColor);
                    drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team);
                }
            }
        }
        pop();

        // --- Draw the revealed new zones ---
        for (let i = 0; i < zoomInAnimationState.recoloredHexes; i++) {
            const newZoneToReveal = zoomInAnimationState.recolorOrder[i].newZone;
            const hexesInNewZone = hexesByZone.get(newZoneToReveal);
            for (const hex of hexesInNewZone) {
                const hexIndex = hexagon.indexOf(hex);
                const hexState = zoomInAnimationState.precalculatedBoard[hexIndex];
                hex.draw(hexIndex); // Draw with its default color
                drawUnit(hex.xHex, hex.yHex, hexState.unit, hexState.team);
            }
        }
    } else if (zoomInAnimationState.phase === 'finalizing') {
        // This phase draws the complete new board state as a preview before control is returned.
        for (let i = 0; i < hexagon.length; i++) {
            const hex = hexagon[i];
            const hexState = zoomInAnimationState.precalculatedBoard[i];
            // Draw the hex with its final, correct zone color.
            hex.draw(i);
            drawUnit(hex.xHex, hex.yHex, hexState.unit, hexState.team);
        }
    }
}

function drawGameBoard() {
    for (let i = 0; i < hexagon.length; i++) {
        const hex = hexagon[i];
        hex.draw(i);
        // hex.showCoordinates(i); // DEBUG: Temporarily disabled for a cleaner UI.
    }
}

function drawAllUnits() {
    for (let i = 0; i < hexagon.length; i++) {
        // Don't draw the unit at the animation's destination,
        // because the drawAnimation() function is handling it.
        if (i !== gameState.animateMovementTo) {
            const hex = hexagon[i];
            drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team);
        }
    }
}

function drawAnimation() {
    if (gameState.animateMovementTo === null) return;

    const from = hexagon[gameState.animateMovementFrom];
    const to = hexagon[gameState.animateMovementTo];
    const progress = gameState.animationLoop / animationLoopSize;

    const currentX = from.xHex * (1 - progress) + to.xHex * progress;
    const currentY = from.yHex * (1 - progress) + to.yHex * progress;

    // Alternate between drawUnit and drawUnitWalking every 11 cycles (16 / 1.5 = 10.66)
    const drawFunc = (floor(gameState.animationLoop / 11) % 2 === 0) ? drawUnit : drawUnitWalking;
    drawFunc(currentX, currentY, to.unit, to.team);

    // Play a step sound every 11 frames of the animation
    if (gameState.animationLoop > 0 && gameState.animationLoop % 11 === 0) {
        if (sounds.move) sounds.move.play();
    }

    gameState.animationLoop++;
    if (gameState.animationLoop >= animationLoopSize) {
        const wasPlayerTurn = gameState.isPlayerTurn;

        gameState.animationLoop = 0;
        gameState.animateMovementTo = null;
        gameState.animateMovementFrom = null;

        // After a move completes, check for standard surround combat for the active player.
        if (wasPlayerTurn) {
            resolveSurroundCombat(PLAYER_TEAM);
            // Check player's zone control
            for (let zone = 1; zone <= 7; zone++) {
                checkZoneControl(zone, PLAYER_TEAM);
            }
        } else {
            resolveSurroundCombat(ENEMY_TEAM);
            // Check AI's zone control
            for (let zone = 1; zone <= 7; zone++) {
                checkZoneControl(zone, ENEMY_TEAM);
            }
            // Save the state after the AI's move and combat resolution are complete
            saveGameState();
        }
    }
}

/**
 * Finds the index of the hexagon that was clicked on.
 * @returns {number} The index of the clicked hexagon, or -1 if no hex was clicked.
 */
function findClickedHex() {
    for (let i = 0; i < hexagon.length; i++) {
        if (clickIsInCircle(hexagon[i].xHex, hexagon[i].yHex)) {
            return i;
        }
    }
    return -1;
}

/**
 * Finds the index of the hexagon physically closest to the mouse cursor's position.
 * This is used for "aiming" UI where the cursor might not be directly over a hex.
 * @returns {number} The index of the closest hexagon, or -1 if the board is empty.
 */
function findClosestHexToMouse() {
    if (!hexagon || hexagon.length === 0) return -1;

    let closestIndex = -1;
    let minDistanceSq = Infinity;

    // Adjust mouse coordinates to be in the same space as the hexes
    const translatedMouseX = mouseX - (width / 2);
    const translatedMouseY = mouseY - (height / 2);
    const scaledMouseX = translatedMouseX / boardScale;
    const scaledMouseY = translatedMouseY / boardScale;

    for (let i = 0; i < hexagon.length; i++) {
        const hexPos = hexToXY(hexagon[i].xHex, hexagon[i].yHex);
        const distanceSq = (scaledMouseX - hexPos.x) ** 2 + (scaledMouseY - hexPos.y) ** 2;
        if (distanceSq < minDistanceSq) {
            minDistanceSq = distanceSq;
            closestIndex = i;
        }
    }
    return closestIndex;
}

/**
 * Handles the logic for selecting a player's unit.
 * @param {number} clickedIndex - The index of the hex that was clicked.
 */
function handleSelectUnit(clickedIndex) {
    const clickedHex = hexagon[clickedIndex];
    if (clickedHex.unit !== 0 && clickedHex.team === PLAYER_TEAM) {
        const hasMovedFromZone = gameState.zonesMovedFromThisTurn.has(clickedHex.zone);
        const isCannon = clickedHex.unit === 4;
        const hasCannonFired = gameState.cannonsFiredThisTurn.has(clickedIndex);

        // Special case: Allow selecting a cannon to set its threat, even if its zone has been used for a move.
        if (isCannon && !hasCannonFired) {
            if (sounds.select) sounds.select.play();
            gameState.badClick = 0;
            gameState.selected = clickedIndex;

            // Only calculate valid moves if the zone has NOT been used for a move.
            if (!hasMovedFromZone) {
                gameState.validMoves = new Set(getValidMovesForUnit(clickedIndex));
            } else {
                gameState.validMoves.clear(); // No moves allowed from a used zone.
            }

            // Always calculate potential targets for an unfired cannon.
            const hexesAtRange1 = getHexesInRange(clickedIndex, 1);
            const hexesAtRange2 = getHexesInRange(clickedIndex, 2);
            gameState.potentialCannonTargets = hexesAtRange2.filter(h => !hexesAtRange1.includes(h));
            return; // Exit after handling the cannon selection.
        }

        // Standard selection logic for all other units (or cannons that have already set a threat).
        if (hasMovedFromZone) {
            if (sounds.error) sounds.error.play();
            gameState.badClick = 6; // "Already moved from this zone."
            return;
        }

        // If we reach here, it's a valid selection for movement.
        if (sounds.select) sounds.select.play();
        gameState.badClick = 0;
        gameState.selected = clickedIndex;
        gameState.validMoves = new Set(getValidMovesForUnit(clickedIndex));

        // Clear cannon targeting info since this isn't a cannon being selected for targeting.
        gameState.potentialCannonTargets = [];
    } else if (clickedHex.unit !== 0 && clickedHex.team !== 1) {
        if (sounds.selectEnemy) sounds.selectEnemy.play();
        gameState.badClick = 4; // "Click on your own units"
    } else {
        if (sounds.error) sounds.error.play();
        gameState.badClick = 1; // "Click on Unit"
    }
}

/**
 * @private
 * Handles the specific logic for a player's cannon action, which can be aiming,
 * confirming a target, or re-aiming. This extracts a complex state machine
 * from the main `handleMoveUnit` function.
 * @param {number} clickedIndex - The index of the hex that was clicked (or -1).
 * @returns {boolean} True if a cannon-specific action was handled, false otherwise.
 */
function _handleCannonAction(clickedIndex) {
    if (gameState.cannonIsAiming) {
        // Player is in aiming mode. Decide whether to confirm, re-aim, or cancel.
        // A click on the cannon itself cancels aiming mode.
        if (clickedIndex === gameState.selected) {
            gameState.cannonIsAiming = false;
            gameState.lockedAimingHexIndex = null;
            // The highlight will be recalculated on the next draw frame.
            return true; // Action handled: canceled aiming.
        }

        const newAimingHexIndex = findClosestHexToMouse();
        if (newAimingHexIndex === gameState.lockedAimingHexIndex) {
            // --- CONFIRM & SET THREAT ---
            // The user clicked the same spot again. Confirm the target.
            const cannonHex = hexagon[gameState.selected];
            const aimingHex = hexagon[gameState.lockedAimingHexIndex];
            const relativeAim = {
                dx: aimingHex.xHex - cannonHex.xHex,
                dy: aimingHex.yHex - cannonHex.yHex
            };
            gameState.cannonThreats.set(gameState.selected, {
                threatenedHexes: gameState.highlightedCannonTargetGroup,
                relativeAim: relativeAim
            });
            gameState.cannonsFiredThisTurn.add(gameState.selected);

            if (sounds.select) sounds.select.play();
            gameState.selected = -1;
            gameState.validMoves.clear();
            gameState.potentialCannonTargets = [];
            gameState.highlightedCannonTargetGroup = null;
            gameState.lastAimingHexIndex = null;
            gameState.cannonIsAiming = false;
            gameState.lockedAimingHexIndex = null;
            return true; // Action handled: threat set.
        } else {
            // --- RE-AIM ---
            // The user clicked a different spot. Update the aim.
            gameState.lockedAimingHexIndex = newAimingHexIndex;
            gameState.highlightedCannonTargetGroup = _calculateCannonTargetGroup(newAimingHexIndex, gameState.potentialCannonTargets);
            // If the new aim is invalid (no targets), cancel aiming mode.
            if (gameState.highlightedCannonTargetGroup.length === 0) {
                gameState.cannonIsAiming = false;
                gameState.lockedAimingHexIndex = null;
            }
            return true; // Action handled: re-aimed.
        }
    } else if (gameState.highlightedCannonTargetGroup && gameState.highlightedCannonTargetGroup.length > 0) {
        // --- ENTER AIMING MODE ---
        // A first click on a valid target area locks the aim.
        gameState.cannonIsAiming = true;
        gameState.lockedAimingHexIndex = gameState.lastAimingHexIndex;
        // The highlighted group is already set by the UI, so it's now "locked".
        return true; // Action handled: entered aiming mode.
    }
    // If we reach here, no cannon-specific action was taken. The click might be a move.
    return false;
}
/**
 * Handles the logic for when a unit is already selected and a hex is clicked.
 * @param {number} clickedIndex - The index of the hex that was clicked.
 */
function handleMoveUnit(clickedIndex) {
    const selectedHex = hexagon[gameState.selected];

    // --- Cannon Action Logic ---
    if (selectedHex.unit === 4) {
        // Delegate to the helper. If it handles the action (returns true), we're done.
        if (_handleCannonAction(clickedIndex)) {
            return;
        }
    }
    // --- Standard Click Logic (requires clicking ON a hex) ---
    // If we reach here, it means the cannon didn't set a threat or aim.
    // All subsequent logic requires a valid hex click.
    if (clickedIndex === -1) {
        if (sounds.error) sounds.error.play();
        gameState.badClick = 3; // "Can't go there"
        return;
    }

    const clickedHex = hexagon[clickedIndex];

    if (clickedIndex === gameState.selected) {
        gameState.selected = -1; // Deselect by clicking the same unit
        gameState.validMoves.clear();
        gameState.potentialCannonTargets = [];
        gameState.badClick = 0;
        return;
    }

    if (gameState.validMoves.has(clickedIndex)) {
        // Move to a valid hex
        if (sounds.move) sounds.move.play();
        gameState.badClick = 0;

        // Record the zone this move originated from.
        gameState.zonesMovedFromThisTurn.add(selectedHex.zone);

        // If a cannon that has a threat area moves, the threat must move with it.
        if (selectedHex.unit === 4 && gameState.cannonThreats.has(gameState.selected)) {
            // If the cannon also set its threat *this turn*, we need to update that tracking set as well.
            // This prevents it from setting another threat in the same turn after moving.
            if (gameState.cannonsFiredThisTurn.has(gameState.selected)) {
                gameState.cannonsFiredThisTurn.delete(gameState.selected);
                gameState.cannonsFiredThisTurn.add(clickedIndex);
            }
            
            // Recalculate the threat area from the new position instead of just translating it.
            // This ensures the threat area correctly reflects edge-of-board limitations.
            const threatData = gameState.cannonThreats.get(gameState.selected);
            const relativeAim = threatData.relativeAim;

            // Calculate the new aiming point based on the cannon's new position.
            const newCannonHex = clickedHex;
            const newAimingHexX = newCannonHex.xHex + relativeAim.dx;
            const newAimingHexY = newCannonHex.yHex + relativeAim.dy;
            const newAimingHexIndex = hexCoordMap.get(`${newAimingHexX},${newAimingHexY}`);

            // Recalculate the threat area from the new position.
            const newThreatArea = [];
            if (newAimingHexIndex !== undefined) {
                // The cannon's new firing ring.
                const hexesAtRange1 = getHexesInRange(clickedIndex, 1);
                const hexesAtRange2 = getHexesInRange(clickedIndex, 2);
                const ringSet = new Set(hexesAtRange2.filter(h => !hexesAtRange1.includes(h)));

                // The new aiming hex and its neighbors.
                const aimingHex = hexagon[newAimingHexIndex];
                const potentialBlastArea = [newAimingHexIndex, ...aimingHex.adjacencies];

                // The new threat area is the intersection of the blast area and the new firing ring.
                for (const hexIndex of potentialBlastArea) {
                    if (ringSet.has(hexIndex)) {
                        newThreatArea.push(hexIndex);
                    }
                }
            }

            // Update the cannonThreats map with the new key (the destination index) and new data.
            gameState.cannonThreats.delete(gameState.selected);
            gameState.cannonThreats.set(clickedIndex, {
                threatenedHexes: newThreatArea,
                relativeAim: relativeAim // The relative aim stays the same
            });
        }

        // Explicitly move the unit and clear the source hex.
        clickedHex.unit = selectedHex.unit;
        clickedHex.team = selectedHex.team;
        selectedHex.unit = 0;
        selectedHex.team = 0;

        gameState.animateMovementFrom = gameState.selected;
        gameState.animateMovementTo = clickedIndex;
        gameState.selected = -1;
        gameState.validMoves.clear();
        gameState.potentialCannonTargets = [];

        // Note: Combat is now handled at the end of the animation,
        // so we no longer need to call checkZoneControl or calculateAllThreats here.

        // Check if the player has moved from all 7 zones.
        if (gameState.zonesMovedFromThisTurn.size >= 7) {
            gameState.endTurn = 1;
            gameState.badClick = 5; // "No more moves"
        }
    } else if (clickedHex.unit !== 0 && clickedHex.team === PLAYER_TEAM) {
        // Clicked on another friendly unit, so select it instead, if its zone is available.
        if (gameState.zonesMovedFromThisTurn.has(clickedHex.zone)) {
            if (sounds.error) sounds.error.play();
            gameState.badClick = 6; // "Already moved from this zone."
            return;
        }
        gameState.badClick = 0;
        gameState.selected = clickedIndex;
        gameState.validMoves = new Set(getValidMovesForUnit(clickedIndex));
        // If the new unit is a cannon, calculate its targets.
        if (clickedHex.unit === 4 && !gameState.cannonsFiredThisTurn.has(clickedIndex)) {
            const hexesAtRange1 = getHexesInRange(clickedIndex, 1);
            const hexesAtRange2 = getHexesInRange(clickedIndex, 2);
            gameState.potentialCannonTargets = hexesAtRange2.filter(h => !hexesAtRange1.includes(h));
        } else {
            gameState.potentialCannonTargets = [];
        }
    } else {
        if (sounds.error) sounds.error.play();
        gameState.badClick = 3; // "Can't go there"
    }
}

/**
 * Handles the logic for selecting a zone on the game board.
 * This function is currently dormant and not integrated into the main game loop.
 * @param {number} clickedIndex - The index of the hex that was clicked.
 */
function handleZoneSelection(clickedIndex) {
    if (sounds.select) sounds.select.play();
    const clickedHex = hexagon[clickedIndex];
    const clickedZone = clickedHex.zone;

    // If the same zone is clicked again, deselect it and exit the mode.
    if (gameState.selectedZone === clickedZone) {
        gameState.selectedZone = null;
        gameState.zoneSelectionMode = false; // Exit zone selection mode
        console.log(`Zone ${clickedZone} deselected. Exiting selection mode.`);
    } else {
        gameState.selectedZone = clickedZone;
        console.log(`Zone ${clickedZone} selected.`);
        // Future logic for zone selection can be added here.
    }
}

/**
 * Handles all click logic for pre-game screens like the intro and instructions.
 * This consolidates logic from the previous `handleIntroScreenClick` and
 * `handleInstructionsScreenClick` functions.
 */
function handleMenuScreenClick() {
    if (gameState.currentScreen === 'intro') {
        if (newGameButton.pressed()) {
            gameState.currentScreen = 'instructions';
            return;
        }
        // Handle difficulty buttons only on the intro screen
        if (handleDifficultyButtons()) {
            return;
        }
    } else if (gameState.currentScreen === 'instructions') {
        if (startButton.pressed()) {
            // Set the game's DIFFICULTY based on the intro screen setting.
            DIFFICULTY = gameState.introScreenDifficulty;
            gameState.currentScreen = 'game';
            startNewLevel(); // Start the first level of the game
            return;
        }
    }
}

/**
 * Handles a click on the main game board. It finds which hex was clicked
 * and then dispatches to the appropriate handler based on the current game
 * state (e.g., zone selection mode, unit selected, etc.).
 */
function handleBoardClick() {
    const clickedIndex = findClickedHex();

    // If in zone selection mode, a click on any hex selects that zone.
    if (gameState.zoneSelectionMode) {
        // Zone selection requires clicking ON a hex.
        if (clickedIndex !== -1) {
            handleZoneSelection(clickedIndex);
        }
        return; // Stop further processing
    }

    if (gameState.selected === -1) {
        // No unit is selected. We must click ON a hex to select one.
        if (clickedIndex !== -1) {
            handleSelectUnit(clickedIndex);
        }
    } else {
        // A unit IS selected. Pass the click to the move handler.
        // It can handle clicks on hexes (move/re-select) or empty space (cannon fire).
        handleMoveUnit(clickedIndex);
    }
}

/**
 * Handles clicks on debug-related buttons.
 * @returns {boolean} True if a debug button was pressed and handled, false otherwise.
 */
function handleDebugButtons() {
    // This function should only be active during development.
    // For now, we'll just check if the buttons exist.
    if (!debugSkipLevelButton) return false;

    if (debugSkipLevelButton.pressed() && gameState.isPlayerTurn) {
        // --- Skip directly to level 5 without animation ---
        console.log("DEBUG: Skipping directly to Level 5.");
        
        // 1. Set the game state for the new level FIRST so that board generation has the correct context.
        gameState = { ...gameState, selected: -1, badClick: 0, zonesMovedFromThisTurn: new Set(), endTurn: 0, isPlayerTurn: true, aiMoveQueue: [], aiZonesMovedFromThisTurn: new Set(), animationLoop: 0, animateMovementFrom: null, animateMovementTo: null, level: 5, playerTurnCount: 1, secretArcherZone: floor(random(6)) + 1, zoneSelectionMode: false, selectedZone: null, cannonsFiredThisTurn: new Set(), cannonThreats: new Map(), animateCannonThreat: null };
        DIFFICULTY = 4; // Level 5 difficulty is 4

        // 2. Generate the new board state.
        const newBoard = [];
        for (let i = 0; i < hexagon.length; i++) {
            newBoard[i] = { unit: 0, team: 0 };
        }

        // Populate Zone 7 (center)
        const zone7UnitPool = [ENEMY_TEAM, ENEMY_TEAM, ENEMY_TEAM, PLAYER_TEAM, PLAYER_TEAM, 0, 0];
        shuffle(zone7UnitPool, true);
        for (let i = 0; i < ZONE_7_HEX_INDICES.length; i++) {
            const hexIndex = ZONE_7_HEX_INDICES[i];
            const team = zone7UnitPool[i];
            newBoard[hexIndex] = { unit: (team === 0) ? 0 : 1, team: team };
        }
        // Populate Outer Zones, passing `null` for the excluded zone since we're creating a full new board.
        populateNewOuterZones(newBoard, null, gameState.level);
        // 3. Apply the new board state to the game.
        for (let i = 0; i < hexagon.length; i++) {
            hexagon[i].unit = newBoard[i].unit;
            hexagon[i].team = newBoard[i].team;
        }
        if (sounds.boom2) sounds.boom2.play();
        return true;
    }

    return false;
}

/**
 * Handles clicks on the Zoom In and Zoom Out buttons.
 * @returns {boolean} True if a zoom button was pressed and handled, false otherwise.
 */
function handleZoomButtons() {
    // The Zoom Out button is a strategic choice for the player.
    const canZoomOut = gameState.isPlayerTurn && gameState.zonesMovedFromThisTurn.size <= 3 && gameState.level < LEVEL_NAMES.length;
    if (zoomOutButton && zoomOutButton.pressed() && canZoomOut) {
        // Check if the scout message is active to award the bonus archer.
        startLevelTransition(isScoutMessageActive());
        return true;
    }

    const canZoomIn = gameState.isPlayerTurn && gameState.level > 1 && gameState.zonesMovedFromThisTurn.size === 0;
    if (zoomInButton && zoomInButton.pressed() && canZoomIn) {
        if (gameState.zoneSelectionMode && gameState.selectedZone !== null) {
            // A zone is selected, so START the zoom-in animation.
            zoomInAnimationState.phase = 'fading_out';
            zoomInAnimationState.progress = 0;
            zoomInAnimationState.sourceZone = gameState.selectedZone;

            const sourceHexes = hexesByZone.get(gameState.selectedZone);
            const avgHexX = sourceHexes.reduce((sum, h) => sum + h.xHex, 0) / sourceHexes.length;
            const avgHexY = sourceHexes.reduce((sum, h) => sum + h.yHex, 0) / sourceHexes.length;
            zoomInAnimationState.startPos = hexToXY(avgHexX, avgHexY);

            // --- Build the recolor order using the new mapsToNewZone property ---
            zoomInAnimationState.recolorOrder = [];
            for (const hex of sourceHexes) {
                if (hex.mapsToNewZone) {
                    zoomInAnimationState.recolorOrder.push({
                        hexIndex: hexagon.indexOf(hex),
                        newZone: hex.mapsToNewZone
                    });
                }
            }
            zoomInAnimationState.recolorOrder.sort((a, b) => a.newZone - b.newZone);

            zoomInAnimationState.precalculatedBoard = generateZoomInBoard(gameState.selectedZone);

            if (sounds.boom1) sounds.boom1.play();

            // Save the state immediately after configuring the animation.
            saveGameState();

            gameState.zoneSelectionMode = false;
            gameState.selectedZone = null;
        } else {
            // No zone is selected, so just toggle the selection mode.
            gameState.zoneSelectionMode = !gameState.zoneSelectionMode;
            gameState.selected = -1;
            gameState.badClick = 0;
            if (gameState.zoneSelectionMode) {
                if (sounds.select) sounds.select.play();
            } else {
                gameState.selectedZone = null;
            }
        }
        return true; // Action was handled
    }
    return false;
}

function handleEndTurnButton() {
    if (endTurnButton.pressed()) {
        // End the turn if at least one move has been made, or if all possible moves have been made.
        if (gameState.zonesMovedFromThisTurn.size > 0 || gameState.endTurn === 1) {
            // Deselect any active unit to clean up the UI state for the AI's turn.
            gameState.selected = -1;
            gameState.validMoves.clear();
            gameState.potentialCannonTargets = [];

            gameState.zonesMovedFromThisTurn.clear();
            gameState.aiMovesMadeThisTurn = 0; // Reset AI move counter
            gameState.aiZonesMovedFromThisTurn.clear(); // Reset AI moves for its turn
            gameState.endTurn = 0;
            gameState.cannonsFiredThisTurn.clear();
            gameState.badClick = 0;
            gameState.playerTurnCount++;
            gameState.isPlayerTurn = false; // Switch to AI's turn
            saveGameState();
        }
        return true; // Fire button was pressed
    }
    return false;
}

function mouseClicked() {
    // This is a p5.js function to enable audio in browsers that block it by default.
    // It needs to be called once after a user interaction (like a click) to allow sounds to play.
    // It's safe to call this multiple times.
    userStartAudio();

    // Block all input if the game has been won.
    if (gameState.gameWon || zoomInAnimationState.phase !== 'inactive') {
        return;
    }

    // Handle clicks on pre-game screens (intro, instructions)
    if (gameState.currentScreen === 'intro' || gameState.currentScreen === 'instructions') {
        handleMenuScreenClick();
        return;
    }

    // Block all input if a unit movement animation is playing to prevent
    // interrupting the animation and skipping the combat phase.
    if (gameState.animateMovementTo !== null) {
        return;
    }

    // Handle debug buttons first
    if (handleDebugButtons()) {
        return;
    }

    // Handle zoom buttons
    if (handleZoomButtons()) {
        return;
    }

    // Block all player input if it's not their turn.
    if (!gameState.isPlayerTurn) {
        return;
    }

    if (handleEndTurnButton()) {
        return; // Exit because the button was handled
    }

    if (gameState.endTurn === 1) {
        gameState.badClick = 5; // "No more moves"
        return;
    }

    handleBoardClick();
    saveGameState();
}

/**
 * Handles clicks on the difficulty adjustment buttons.
 * @returns {boolean} True if a difficulty button was pressed, false otherwise.
 */
function handleDifficultyButtons() {
    if (upArrowButton.pressed()) {
        gameState.introScreenDifficulty = min(gameState.introScreenDifficulty + 1, 10);
        if (sounds.select) sounds.select.play();
        return true;
    }
    if (downArrowButton.pressed()) {
        gameState.introScreenDifficulty = max(gameState.introScreenDifficulty - 1, -5);
        if (sounds.select) sounds.select.play();
        return true;
    }
    return false;
}

/**
 * Saves the current game state to the browser's localStorage.
 */
function saveGameState() {
    // Do not save if we are not on the game screen.
    if (gameState.currentScreen !== 'game') {
        return;
    }
    try {
        const hexState = hexagon.map(h => ({ unit: h.unit, team: h.team }));

        // Prepare animation states for serialization
        const serializableZoomOutState = {
            ...zoomOutAnimationState,
            revealMap: Array.from(zoomOutAnimationState.revealMap.entries()) // Convert Map to Array
        };

        const stateToSave = {
            gameState: {
                ...gameState,
                // Convert Sets to Arrays for JSON serialization
                zonesMovedFromThisTurn: Array.from(gameState.zonesMovedFromThisTurn),                
                aiZonesMovedFromThisTurn: Array.from(gameState.aiZonesMovedFromThisTurn),
                validMoves: Array.from(gameState.validMoves),
                scoutMessageShownOnLevels: Array.from(gameState.scoutMessageShownOnLevels),
                cannonsFiredThisTurn: Array.from(gameState.cannonsFiredThisTurn),
                cannonThreats: Array.from(gameState.cannonThreats.entries()),
                // Convert the levelMemory Map to a serializable array of [key, value] pairs.
                levelMemory: Array.from(gameState.levelMemory.entries()),
                // We don't need to save the animation or click states
                animationLoop: 0,
                animateMovementFrom: null,
                animateMovementTo: null,
                badClick: 0,
            },
            hexState: hexState,
            DIFFICULTY: DIFFICULTY,
            zoomOutAnimationState: serializableZoomOutState,
            zoomInAnimationState: zoomInAnimationState // This one is already serializable
        };

        localStorage.setItem('zoomBftmSaveState', JSON.stringify(stateToSave));
        // console.log("Game state saved."); // Can be noisy, uncomment for debugging
    } catch (e) {
        console.error("Failed to save game state:", e);
    }
}

/**
 * Loads the game state from localStorage if it exists.
 * @returns {boolean} True if a state was successfully loaded, false otherwise.
 */
function loadGameState() {
    try {
        const savedStateJSON = localStorage.getItem('zoomBftmSaveState');
        if (!savedStateJSON) {
            return false;
        }

        const savedState = JSON.parse(savedStateJSON);

        // VALIDATION: Check if the saved state is a valid, in-progress game.
        // A saved game must have a gameState object and be on level 1 or higher.
        if (!savedState.gameState || !savedState.gameState.level || savedState.gameState.level < 1) {
            console.warn("Found invalid or old save data. Discarding it.");
            localStorage.removeItem('zoomBftmSaveState'); // Clean up the bad data
            return false;
        }

        // Restore game state
        gameState = {
            ...savedState.gameState,
            // Convert Arrays back to Sets
            zonesMovedFromThisTurn: new Set(savedState.gameState.zonesMovedFromThisTurn),
            aiZonesMovedFromThisTurn: new Set(savedState.gameState.aiZonesMovedFromThisTurn),            
            validMoves: new Set(savedState.gameState.validMoves),
            // Gracefully handle old save files that don't have the scout message history
            scoutMessageShownOnLevels: new Set(savedState.gameState.scoutMessageShownOnLevels || []),
            cannonsFiredThisTurn: new Set(savedState.gameState.cannonsFiredThisTurn || []),
            cannonThreats: new Map(savedState.gameState.cannonThreats || []),
            // Restore the levelMemory Map from its serialized array format.
            levelMemory: new Map(savedState.gameState.levelMemory || []),
        };

        // Restore hex board
        for (let i = 0; i < hexagon.length; i++) {
            hexagon[i].unit = savedState.hexState[i].unit;
            hexagon[i].team = savedState.hexState[i].team;
        }

        // Restore animation states, if they exist in the save file
        if (savedState.zoomOutAnimationState) {
            zoomOutAnimationState = {
                ...savedState.zoomOutAnimationState,
                revealMap: new Map(savedState.zoomOutAnimationState.revealMap) // Convert Array back to Map
            };
        }
        if (savedState.zoomInAnimationState) {
            zoomInAnimationState = savedState.zoomInAnimationState;
        }

        // Restore difficulty
        DIFFICULTY = savedState.DIFFICULTY;

        console.log("Game state loaded successfully.");
        return true;
    } catch (e) {
        console.error("Failed to load game state:", e);
        // If loading fails, clear the bad data to prevent future errors
        localStorage.removeItem('zoomBftmSaveState');
        return false;
    }
}
/*  */