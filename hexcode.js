//Player is black.  

//Eliminate enemies by surrounding on three sides.
const PLAYER_TEAM = 1;
const ENEMY_TEAM = 2;
const hexSize = 25;
let DIFFICULTY = -1; // Initialized at -1, +1 per level. 0=9/9 dice, 1=9/10, 2=8/10, etc.
const r = hexSize; // "radius"
let animationLoopSize = 53;
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

const ANIMATION_SPEED_CONFIG = [
    { label: "Normal", secondLabel: "Animation", multiplier: 1.0 },
    { label: "Fast", secondLabel: "Animation", multiplier: 0.5 },
    { label: "Very Fast", secondLabel: "Animation", multiplier: 0.25 },
    { label: "Slow", secondLabel: "Animation", multiplier: 2.0 }
];

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
    VULNERABLE_ZONE: -150,
    CANNON_TARGET_ACTION_BONUS: 200, // A large bonus to ensure the AI always considers targeting with its cannon.
    TARGET_GROUP_SIZE_BONUS: 10 // Bonus per hex in the target area.
};

/**
 * Defines the "point value" of each unit. This is used to calculate a team's
 * total strength in a zone for determining unit promotions on level-up.
 */
const UNIT_VALUES = {
    1: 1,   // Soldier
    2: 3,   // Archer
    3: 1.5, // Cavalry
    4: 2    // Cannon
};

/**
 * Defines a strength hierarchy for unit types, used to ensure that a unit
 * promotion never results in a weaker unit.
 */
const UNIT_STRENGTH_RANK = { 1: 1, 3: 2, 4: 3, 2: 4 }; // Soldier < Cavalry < Cannon < Archer

/**
 * Defines the rules for promoting a standard soldier to a special unit type
 * when a zone is captured at the end of a level. The rules are ordered by priority,
 * with the strongest or most specific units appearing first.
 */
const SPECIAL_UNIT_PROMOTION_RULES = [
    // Rules should be ordered by priority (strongest unit first)
    { unitType: 2, pointAdvantage: 6, unlockFlag: 'hasBeenOnLevel3' }, // Archer
    { unitType: 4, pointAdvantage: 4, unlockFlag: 'hasBeenOnLevel5' }, // Cannon
    // Cavalry are unlocked after the player has been on level 2.
    { unitType: 3, pointAdvantage: 3, unlockFlag: 'hasBeenOnLevel2' }  // Cavalry
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
let optionsNewGameButton;
let optionsBackButton;
let volumeControl;
let movementAnimationControl;
let zoomAnimationControl;
let difficultyControl;
let audioInitialized = false;

/**
 * Creates and returns a new, default gameState object.
 * This is the single source of truth for the initial state of the game,
 * ensuring a clean slate when starting a new game.
 */
function createDefaultGameState() {
    return {
        selected: -1,
        badClick: 0,
        zonesMovedFromThisTurn: new Set(),
        endTurn: 0,
        isPlayerTurn: true,
        aiMoveQueue: [],
        aiZonesMovedFromThisTurn: new Set(),
        aiMovesMadeThisTurn: 0,
        introScreenDifficulty: 0,
        validMoves: new Set(),
        currentScreen: 'intro',
        animationLoop: 0,
        animateMovementFrom: null,
        animateMovementTo: null,
        levelMemory: new Map(),
        level: 0,
        gameWon: false,
        winRotation: 0,
        hasBeenOnLevel5: false,
        hasBeenOnLevel3: false,
        hasBeenOnLevel2: false,
        playerTurnCount: 0,
        scoutMessageShownOnLevels: new Set(),
        secretArcherZone: null,
        potentialCannonTargets: [],
        highlightedCannonTargetGroup: null,
        cannonIsAiming: false,
        lockedAimingDirectionIndex: null, // The aiming direction index (0-11) locked in by the player
        lastAimingDirectionIndex: null, // The last aiming direction the mouse was indicating
        animateCannonThreat: null,
        cannonThreats: new Map(),
        cannonsThatTargetedThisTurn: new Set(),
        selectedZone: null,
        zoneSelectionMode: false,
        movementAnimationSpeedSetting: 0, // 0: Normal, 1: Fast, 2: Very Fast, 3: Slow
        zoomAnimationSpeedSetting: 0, // 0: Normal, 1: Fast, 2: Very Fast, 3: Slow
        masterVolume: 10, // On a scale of 0-10
    };
}
let gameState = createDefaultGameState();

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

let CANNON_DIRECTIONS;
let CANNON_AIM_OFFSETS;

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

/**
 * @private
 * Checks if a given point is within the clickable circle of a hex.
 * This is a helper for findClickedHex, which pre-calculates the scaled mouse coordinates.
 * @param {number} scaledMouseX - The pre-scaled and translated X coordinate of the mouse.
 * @param {number} scaledMouseY - The pre-scaled and translated Y coordinate of the mouse.
 * @param {Hexagon} hex - The hexagon object to check against.
 * @returns {boolean} True if the point is inside the circle.
 */
function _isClickInCircle(scaledMouseX, scaledMouseY, hex) {
    const hexPos = hexToXY(hex.xHex, hex.yHex);
    return (scaledMouseX - hexPos.x) ** 2 + (scaledMouseY - hexPos.y) ** 2 < (r * 13 / 16) ** 2;
}

let zoneColor = [];

class Button {
    constructor(x, y, radius, label, secondLabel, arrowStyle = 'none', shape = 'circle', widthMultiplier = 1) {
        this.x = x; // Absolute canvas coordinates
        this.y = y; // Absolute canvas coordinates
        this.radius = radius; // For circles: radius. For rectangles: half-width.
        this.label = label;
        this.secondLabel = secondLabel;
        this.arrowStyle = arrowStyle;
        this.shape = shape;
        this.widthMultiplier = widthMultiplier;
    }

    draw(isActive = true, isToggled = false) {
        // The main draw loop is translated to the center of the screen.
        // We must subtract the center coordinates to draw the button at its absolute position.
        const drawX = this.x - (width / 2);
        const drawY = this.y - (height / 2);

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

        if (this.shape === 'rectangle') {
            const baseWidth = this.radius * (13 / 16) * 2;
            const rectWidth = baseWidth * this.widthMultiplier;
            const rectHeight = baseWidth * 0.6;
            rectMode(CENTER);
            rect(drawX, drawY, rectWidth, rectHeight, 10); // Use a corner radius
            rectMode(CORNER); // Reset
        } else { // circle
            const buttonCircleRadius = this.radius * 13 / 16;
            ellipse(drawX, drawY, buttonCircleRadius * 2, buttonCircleRadius * 2);
        }

        // --- Draw Arrows (if applicable) ---
        if (this.arrowStyle !== 'none') {
            stroke(arrowColor);
            strokeWeight(2); // Match button border thickness
            noFill(); // Arrows are lines, not filled shapes

            const outerOffset = this.radius * 0.075; // Reduced distance from button edge to arrow start
            const buttonCircleRadius = this.radius * 13 / 16; // Arrows are only on circles
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

        // Add a small vertical offset for rectangular buttons to better center the text visually.
        // This is because the default font's vertical center isn't always the visual center.
        const yOffset = (this.shape === 'rectangle') ? this.radius * (2 / baseRadius) : 0;

        if (this.secondLabel) {
            textSize(this.radius * (19 / baseRadius));
            text(this.label, drawX, drawY - (this.radius * (5 / baseRadius)) - yOffset);
            textSize(this.radius * (13 / baseRadius));
            text(this.secondLabel, drawX, drawY + (this.radius * (12 / baseRadius)) - yOffset);
        } else {
            // If there's no second label, draw the first one centered vertically.
            // Single-line text needs a slight downward adjustment for better visual centering,
            // as opposed to the upward adjustment needed for the two-line text block.
            const downwardAdjustment = (this.shape === 'rectangle') ? this.radius * (1 / baseRadius) : 0;
            textSize(this.radius * (14 / baseRadius)); // Use a smaller size for long single-line text
            text(this.label, drawX, drawY + downwardAdjustment);
        }
        textAlign(LEFT, BASELINE); // Reset alignment
    }

    pressed() {
        if (this.shape === 'rectangle') {
            const baseWidth = this.radius * (13 / 16) * 2;
            const rectWidth = baseWidth * this.widthMultiplier;
            const rectHeight = baseWidth * 0.6;
            const halfWidth = rectWidth / 2;
            const halfHeight = rectHeight / 2;
            return (mouseX > this.x - halfWidth && mouseX < this.x + halfWidth &&
                mouseY > this.y - halfHeight && mouseY < this.y + halfHeight);
        } else { // circle
            // Check distance against absolute mouse coordinates
            return dist(mouseX, mouseY, this.x, this.y) < (this.radius * 13 / 16);
        }
    }
}

class OptionControl {
    constructor(label, centerX, centerY, valueGetter, valueSetter) {
        this.label = label;
        this.centerX = centerX;
        this.centerY = centerY;
        this.valueGetter = valueGetter;
        this.valueSetter = valueSetter;

        // Create the up and down arrow buttons for this control
        const buttonRadius = 20 * boardScale;
        const baseWidth = buttonRadius * (13 / 16) * 2;
        const buttonHeight = baseWidth * 0.6;
        const verticalOffset = buttonHeight * 0.6;

        this.upArrowButton = new Button(this.centerX, this.centerY - verticalOffset, buttonRadius, "", null, 'none', 'rectangle');
        this.downArrowButton = new Button(this.centerX, this.centerY + verticalOffset, buttonRadius, "", null, 'none', 'rectangle');
    }

    _drawChevron(centerX, centerY, size, direction) {
        const halfSize = size / 2;
        if (direction === 'up') {
            line(centerX - size, centerY + halfSize, centerX, centerY - halfSize);
            line(centerX, centerY - halfSize, centerX + size, centerY + halfSize);
        } else { // 'down'
            line(centerX - size, centerY - halfSize, centerX, centerY + halfSize);
            line(centerX, centerY + halfSize, centerX + size, centerY - halfSize);
        }
    }

    draw() {
        // 1. Draw the button bodies
        this.upArrowButton.draw(true);
        this.downArrowButton.draw(true);

        // 2. Draw the chevrons inside the buttons
        const arrowSize = 6 * boardScale;
        const arrowColor = color(50);
        stroke(arrowColor);
        strokeWeight(2.5 * boardScale);
        noFill();

        this._drawChevron(this.upArrowButton.x - (width / 2), this.upArrowButton.y - (height / 2), arrowSize, 'up');
        this._drawChevron(this.downArrowButton.x - (width / 2), this.downArrowButton.y - (height / 2), arrowSize, 'down');

        // 3. Draw the text label and value
        noStroke();
        fill(0);
        textSize(22 * boardScale);

        const buttonStackCenterX = this.centerX - (width / 2);
        const buttonStackWidth = (this.upArrowButton.radius * (13 / 16) * 2) * this.upArrowButton.widthMultiplier;
        const textPadding = 10 * boardScale;
        const textCenterY = this.centerY - (height / 2);

        textAlign(RIGHT, CENTER);
        text(this.label, buttonStackCenterX - buttonStackWidth / 2 - textPadding, textCenterY);

        textAlign(LEFT, CENTER);
        text(this.valueGetter(), buttonStackCenterX + buttonStackWidth / 2 + textPadding, textCenterY);
    }

    handleClicks() {
        if (this.upArrowButton.pressed()) {
            this.valueSetter('up');
            if (sounds.select) sounds.select.play();
            return true;
        }
        if (this.downArrowButton.pressed()) {
            this.valueSetter('down');
            if (sounds.select) sounds.select.play();
            return true;
        }
        return false;
    }
}

/**
 * Gets the animation speed multiplier based on the current user setting.
 * @returns {number} The multiplier (e.g., 1.0 for normal, 0.5 for fast).
 */
function getMovementAnimationSpeedMultiplier() {
    if (ANIMATION_SPEED_CONFIG[gameState.movementAnimationSpeedSetting]) {
        return ANIMATION_SPEED_CONFIG[gameState.movementAnimationSpeedSetting].multiplier;
    }
    return 1.0; // Default to normal speed if setting is invalid
}

/**
 * Gets the zoom animation speed multiplier based on the current user setting.
 * @returns {number} The multiplier (e.g., 1.0 for normal, 0.5 for fast).
 */
function getZoomAnimationSpeedMultiplier() {
    if (ANIMATION_SPEED_CONFIG[gameState.zoomAnimationSpeedSetting]) {
        return ANIMATION_SPEED_CONFIG[gameState.zoomAnimationSpeedSetting].multiplier;
    }
    return 1.0; // Default to normal speed if setting is invalid
}

/**
 * Updates the global animation speed variables based on the current setting.
 * This should be called whenever the setting changes or a game is loaded.
 */
function updateAnimationSpeed() {
    const multiplier = getMovementAnimationSpeedMultiplier();
    animationLoopSize = 53 * multiplier;
}

/**
 * Updates the p5.js master volume based on the current game setting.
 * This should be called whenever the setting changes or a game is loaded.
 */
function updateMasterVolume() {
    // Don't try to set volume if the sound library isn't ready.
    // We can check for one of the sound objects to exist as a proxy.
    if (!sounds.select) {
        return;
    }
    const volumeLevel = constrain(gameState.masterVolume, 0, 10);
    const p5Volume = volumeLevel / 10.0;

    // Set volume individually for each sound, which is more reliable than masterVolume.
    // The base volumes are preserved as multipliers.
    if (sounds.boom1) sounds.boom1.setVolume(0.5 * p5Volume);
    if (sounds.boom2) sounds.boom2.setVolume(0.5 * p5Volume);
    if (sounds.select) sounds.select.setVolume(1.0 * p5Volume);
    if (sounds.selectEnemy) sounds.selectEnemy.setVolume(1.0 * p5Volume);
    if (sounds.error) sounds.error.setVolume(0.7 * p5Volume);
    if (sounds.move) sounds.move.setVolume(0.8 * p5Volume);
}

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

    draw(index, overrideColor = null, hoveredZone = null) {
        const { fillColor, strokeColor, sw } = this._getHexStyle(index, overrideColor, hoveredZone);

        // Apply styles and draw the hexagon shape.
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

    /**
     * @private
     * Determines the correct styling for a hex based on the current game state.
     * This centralizes the complex styling logic, separating it from the drawing command.
     * @param {number} index - The index of this hex.
     * @param {p5.Color | null} overrideColor - A color to use for animations.
     * @param {number | null} hoveredZone - The zone the mouse is currently hovering over.
     * @returns {{fillColor: p5.Color, strokeColor: p5.Color, sw: number}} The styling properties.
     */
    _getHexStyle(index, overrideColor, hoveredZone) {
        let fillColor = overrideColor || zoneColor[this.zone];
        let strokeColor = color(0); // Default black
        let sw = r / 18; // Default stroke weight

        // --- Determine style based on priority (highest priority checks last) ---

        // Hovered zone highlight (lowest priority)
        if (gameState.zoneSelectionMode && hoveredZone === this.zone && gameState.selectedZone !== this.zone) {
            // The previous method of lightening the fill was too subtle on light-colored zones.
            // A thick white stroke provides a much clearer and more consistent highlight.
            strokeColor = color(255); // White outline for hover
            sw = 3;
        }

        // Selected zone highlight
        if (zoomInAnimationState.phase === 'inactive' && gameState.selectedZone === this.zone) {
            strokeColor = color(255, 255, 0); // Yellow
            sw = 3;
            fillColor = lerpColor(fillColor, color(0), 0.3);
        }

        // Selected unit and valid moves (highest priority)
        if (zoomOutAnimationState.phase === 'inactive' && gameState.selected !== -1) {
            if (gameState.validMoves.has(index)) {
                strokeColor = color(0, 106, 255); // Lighter blue for valid move
                sw = 4;
                fillColor = color(129, 133, 129); // Greenish fill for valid move
            } else if (gameState.selected === index) {
                strokeColor = color(4, 0, 255); // Blue outline for selected
                sw = 4;
                fillColor = color(105, 101, 101); // Grey fill for selected
            }
        }

        return { fillColor, strokeColor, sw };
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
    strokeWeight(1); // Set a thin stroke for the detailed parts (head, bow).
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
 * @param {number | null} [aimingAngle=null] - The angle in radians the cannon should aim.
 */
function drawCannon(xHex, yHex, team, isWalking, aimingAngle = null) {
    const x = hexToXY(xHex, yHex).x;
    const y = hexToXY(xHex, yHex).y;

    push();
    // 1. Translate to the hex's center, which will be the pivot point for rotation.
    translate(x, y);

    // 2. Determine the rotation for the entire cannon graphic.
    // If an aiming angle is provided, use it. Otherwise, use a default "resting" angle.
    // The resting angle of 0 points the cannon straight to the right.
    let rotation = (aimingAngle !== null) ? aimingAngle : 0;

    // 3. Check if the cannon is pointing "backwards" (more than 90 degrees from straight right).
    // The angles for 6 o'clock and 12 o'clock are PI/2 and -PI/2 respectively.
    // We want to flip the graphic if it's pointing anywhere in the left hemisphere.
    const isPointingBackwards = rotation > PI / 2 || rotation < -PI / 2;

    if (isPointingBackwards) {
        scale(-1, 1);
        rotation = PI - rotation;
    }

    // 4. Apply the rotation after the potential flip.
    rotate(rotation);

    // --- Set Styles ---
    // The cannon is drawn almost entirely in the team's main color.
    stroke(teamColors[team].mainColor);
    strokeWeight(3);
    noFill();

    // 5. Draw all cannon components relative to the new, transformed coordinate system.
    // We draw them as if the cannon is pointing to the right (angle = 0).
    // The rotation handles the final orientation.

    // --- Barrel ---
    // The barrel projects forward from the pivot point (0,0).
    const barrelLength = 22 * 0.8;
    const barrelStartX = 0;
    const barrelStartY = 0;
    const barrelEndX = barrelLength;
    const barrelEndY = 0;

    push();
    strokeWeight(5); // Use a thicker line for the barrel to give it presence.
    line(barrelStartX, barrelStartY, barrelEndX, barrelEndY);
    pop();

    // --- Wheel ---
    // The wheel is positioned below the barrel's pivot point.
    const wheelRadius = 10;
    const wheelX = 0;
    const wheelY = 8; // Position the wheel's center below the pivot.

    // Draw the spokes first
    for (let i = 0; i < 8; i++) {
        const angle = i * PI / 4;
        const spokeX = wheelX + wheelRadius * cos(angle);
        const spokeY = wheelY + wheelRadius * sin(angle);
        line(wheelX, wheelY, spokeX, spokeY);
    }

    // Draw the rim of the wheel on top of the spokes
    ellipse(wheelX, wheelY, wheelRadius * 2, wheelRadius * 2);

    pop();
    strokeWeight(1); // Reset
}

/**
 * @private
 * Determines the correct aiming angle for a cannon based on the current game state.
 * This checks for player aiming previews and persistent AI threats.
 * @param {number} cannonIndex - The index of the cannon to check.
 * @returns {number | null} The angle in radians, or null if the cannon is not aiming.
 */
function _getCannonAimingAngle(cannonIndex) {
    if (cannonIndex === null || cannonIndex === undefined) return null;

    // 1. Check for player's LOCKED-IN aim (after the first click).
    // If the player has clicked once to aim, the cannon should snap to that direction.
    if (gameState.selected === cannonIndex && gameState.cannonIsAiming) {
        const directionIndex = gameState.lockedAimingDirectionIndex;
        if (directionIndex !== null && CANNON_DIRECTIONS[directionIndex] !== undefined) {
            return CANNON_DIRECTIONS[directionIndex];
        }
    }

    // 2. If not actively aiming, check for a persistent threat set by any cannon.
    // This will be the cannon's direction before the first click, or its resting state
    // after firing.
    if (gameState.cannonThreats.has(cannonIndex)) {
        const threatData = gameState.cannonThreats.get(cannonIndex);
        const directionIndex = threatData.directionIndex;
        if (directionIndex !== null && CANNON_DIRECTIONS[directionIndex] !== undefined) {
            return CANNON_DIRECTIONS[directionIndex];
        }
    }
    // 3. If no aiming or threat information is found, return null. This will cause
    // the drawCannon function to use its default resting angle.
    return null;
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
 * @param {number | null} [index=null] - The hex index of the unit, used for state-dependent drawing.
 */
function _drawUnit(xHex, yHex, unitType, team, isWalking, index = null) {
    if (unitType === 1) drawSoldier(xHex, yHex, team, isWalking);
    else if (unitType === 2) drawArcher(xHex, yHex, team, isWalking);
    else if (unitType === 3) drawCavalry(xHex, yHex, team, isWalking);
    else if (unitType === 4) {
        const aimingAngle = _getCannonAimingAngle(index);
        drawCannon(xHex, yHex, team, isWalking, aimingAngle);
    }
}

function drawUnit(xHexE, yHexE, unit, team, index = null) {
    _drawUnit(xHexE, yHexE, unit, team, false, index);
};

function drawUnitWalking(xHexF, yHexF, unit, team, index = null) {
    _drawUnit(xHexF, yHexF, unit, team, true, index);
};


/**
 * @private
 * Determines the closest of the 12 discrete firing directions from a cannon to the mouse.
 * @param {number} cannonIndex - The index of the cannon that is aiming.
 * @returns {number} The direction index (0-11) that is closest to the mouse angle.
 */
function _getDirectionFromMouse(cannonIndex) {
    const cannonPos = hexToXY(hexagon[cannonIndex].xHex, hexagon[cannonIndex].yHex);
    const translatedMouseX = mouseX - (width / 2);
    const translatedMouseY = mouseY - (height / 2);
    const scaledMouseX = translatedMouseX / boardScale;
    const scaledMouseY = translatedMouseY / boardScale;

    const angle = atan2(scaledMouseY - cannonPos.y, scaledMouseX - cannonPos.x);

    let closestDirection = -1;
    let minAngleDiff = TWO_PI;

    for (let i = 0; i < CANNON_DIRECTIONS.length; i++) {
        let diff = abs(angle - CANNON_DIRECTIONS[i]);
        if (diff > PI) {
            diff = TWO_PI - diff;
        }
        if (diff < minAngleDiff) {
            minAngleDiff = diff;
            closestDirection = i;
        }
    }
    return closestDirection;
}

/**
 * @private
 * Calculates a potential cannon target group based on a cannon's position and a firing direction.
 * @param {number} cannonIndex - The index of the cannon firing.
 * @param {number} directionIndex - The direction (0-11) the cannon is firing.
 * @returns {Array<number>} An array of hex indices that form the target group.
 */
function _calculateCannonTargetGroupFromDirection(cannonIndex, directionIndex) {
    const cannonHex = hexagon[cannonIndex];
    const aimOffset = CANNON_AIM_OFFSETS[directionIndex];
    const aimingHexX = cannonHex.xHex + aimOffset.dx;
    const aimingHexY = cannonHex.yHex + aimOffset.dy;

    // The cannon's firing ring.
    const hexesAtRange1 = new Set(getHexesInRange(cannonIndex, 1));
    const hexesAtRange2 = getHexesInRange(cannonIndex, 2);
    const ringSet = new Set(hexesAtRange2.filter(h => !hexesAtRange1.has(h)));

    // Define the 6 neighbor coordinate offsets for this grid system.
    const neighborOffsets = [
        { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: -1, dy: 0 },
        { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }
    ];

    // Calculate the coordinates of the aiming point and all its theoretical neighbors.
    const potentialBlastCoords = [{ x: aimingHexX, y: aimingHexY }];
    for (const offset of neighborOffsets) {
        potentialBlastCoords.push({ x: aimingHexX + offset.dx, y: aimingHexY + offset.dy });
    }

    // Find which of these theoretical hexes actually exist on the board.
    const potentialBlastArea = [];
    for (const coords of potentialBlastCoords) {
        const hexIndex = hexCoordMap.get(`${coords.x},${coords.y}`);
        if (hexIndex !== undefined) {
            potentialBlastArea.push(hexIndex);
        }
    }

    // The new threat area is the intersection of the valid blast area and the cannon's firing ring.
    const targetGroup = [];
    for (const hexIndex of potentialBlastArea) {
        if (ringSet.has(hexIndex)) {
            targetGroup.push(hexIndex);
        }
    }
    return targetGroup;
}

function _getDirectionBetweenHexes(sourceIndex, aimIndex) {
    const sourcePos = hexToXY(hexagon[sourceIndex].xHex, hexagon[sourceIndex].yHex);
    const aimPos = hexToXY(hexagon[aimIndex].xHex, hexagon[aimIndex].yHex);

    const angle = atan2(aimPos.y - sourcePos.y, aimPos.x - sourcePos.x);

    let closestDirection = -1;
    let minAngleDiff = TWO_PI;

    for (let i = 0; i < CANNON_DIRECTIONS.length; i++) {
        let diff = abs(angle - CANNON_DIRECTIONS[i]);
        if (diff > PI) {
            diff = TWO_PI - diff;
        }
        if (diff < minAngleDiff) {
            minAngleDiff = diff;
            closestDirection = i;
        }
    }
    return closestDirection;
}

/**
 * @private
 * Sets or updates a cannon's threat area. This is the single source of truth
 * for applying a cannon's targeted threat to the game state.
 * @param {number} cannonIndex - The index of the cannon setting the threat.
 * @param {number} directionIndex - The direction (0-11) the cannon is aiming.
 */
function _setCannonThreat(cannonIndex, directionIndex) {
    const targetGroup = _calculateCannonTargetGroupFromDirection(cannonIndex, directionIndex);
    // It's possible to aim at an area with no valid hexes (e.g., off the board edge).
    // In this case, we don't set a threat. The AI evaluation should prevent this,
    // and the player UI won't allow it, but this is a good safeguard.
    if (targetGroup.length === 0) {
        console.warn(`Attempted to set a cannon threat with no valid targets for cannon ${cannonIndex} in direction ${directionIndex}.`);
        return;
    }

    gameState.cannonThreats.set(cannonIndex, {
        threatenedHexes: targetGroup,
        directionIndex: directionIndex
    });
    gameState.cannonsThatTargetedThisTurn.add(cannonIndex);
}

/**
 * @private
 * Moves a cannon's state (threat area and action status) when the cannon itself moves.
 * This is called for both player and AI moves to keep logic unified.
 * @param {number} fromIndex - The source hex index of the moving cannon.
 * @param {number} toIndex - The destination hex index of the moving cannon.
 */
function _moveCannonThreat(fromIndex, toIndex) {
    // This function only applies to cannons.
    if (hexagon[fromIndex].unit !== 4) {
        return;
    }

    // If the cannon had an active threat, move the threat area.
    if (gameState.cannonThreats.has(fromIndex)) {
        const threatData = gameState.cannonThreats.get(fromIndex);
        const directionIndex = threatData.directionIndex;

        // Remove the old threat.
        gameState.cannonThreats.delete(fromIndex);

        // Recalculate and set the new threat from the destination. // prettier-ignore
        const newThreatArea = _calculateCannonTargetGroupFromDirection(toIndex, directionIndex);
        gameState.cannonThreats.set(toIndex, { threatenedHexes: newThreatArea, directionIndex: directionIndex });
    }

    // If the cannon has already targeted this turn, update its "acted" status to the new location.
    // This prevents it from targeting again after moving.
    if (gameState.cannonsThatTargetedThisTurn.has(fromIndex)) {
        gameState.cannonsThatTargetedThisTurn.delete(fromIndex);
        gameState.cannonsThatTargetedThisTurn.add(toIndex);
    }
}

/**
 * Draws the UI for cannon targeting, highlighting the ring of potential targets.
 */
function drawCannonTargetingUI() {
    // Part 1: Draw persistent threats from all cannons on the board.

    // If the player is confirming a new target, draw the cannon's OLD threat area
    // in a lighter, de-emphasized color first. This makes it clear which threat
    // area will be replaced.
    if (gameState.cannonIsAiming && gameState.cannonThreats.has(gameState.selected)) {
        const threatData = gameState.cannonThreats.get(gameState.selected);
        const baseColor = color(0, 0, 139); // Player's threat is always blue
        const fadedColor = lerpColor(baseColor, color(220, 220, 220), 0.6); // Blend with light gray

        stroke(fadedColor);
        strokeWeight(4);
        noFill();
        for (const hexIndex of threatData.threatenedHexes) {
            const hex = hexagon[hexIndex];
            const pos = hexToXY(hex.xHex, hex.yHex);
            drawMiniHexagon(pos.x, pos.y, r);
        }
    }

    // First, count how many cannons from each team threaten each hex. This allows us to
    // draw a thicker border for hexes threatened by multiple cannons.
    const threatsByHex = new Map();
    for (const [cannonIndex, threatData] of gameState.cannonThreats.entries()) {
        // If we are aiming, skip the threat from the selected cannon because we just drew it separately.
        if (gameState.cannonIsAiming && cannonIndex === gameState.selected) {
            continue;
        }
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
        const hoveredHexIndex = findClickedHex();

        // If the mouse is over a valid move hex, don't show any aiming preview.
        if (hoveredHexIndex !== -1 && gameState.validMoves.has(hoveredHexIndex)) {
            gameState.lastAimingDirectionIndex = null;
        } else {
            // Otherwise, determine the aiming direction from the mouse position.
            const directionIndex = _getDirectionFromMouse(gameState.selected);
            gameState.lastAimingDirectionIndex = directionIndex;
            gameState.highlightedCannonTargetGroup = _calculateCannonTargetGroupFromDirection(gameState.selected, directionIndex);
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
    1: { size: 20, lines: ["Click on Unit"], x: 120, y: -130 },
    2: { size: 20, lines: ["Move to Open Hex"], x: 115, y: -130 },
    3: { size: 20, lines: ["Can't go there"], x: 164, y: -130 },
    4: { size: 20, lines: ["Click on your", "own units,", "dude!"], x: [150, 165, 180], y: [-143, -122, -101] },
    5: { size: 20, lines: ["No more moves.", "Click 'End Turn'"], x: [115, 125], y: [-138, -117] },
    6: { size: 20, lines: ["Already moved", "from this zone."], x: [159, 169], y: [-138, -117] },
    7: { size: 20, lines: ["Click 'Zoom In' to", "confirm. Deselect", "zone to exit."], x: [115, 125, 135], y: [-138, -117, -96] },
    // Consolidated messages
    8: { size: 20, lines: ["Select zone", "to Zoom in"], x: [115, 125], y: [-138, -117] },
    9: { size: 20, lines: ["Where to?"], x: 152, y: -130 },
    10: { size: 20, lines: ["Select target", "hexes"], x: [115, 125], y: [-138, -117] },
    11: { size: 20, lines: ["Move or Select", "target hexes"], x: [115, 125], y: [-138, -117] },
    12: { size: 20, lines: ["Tap again to confirm", "or aim elsewhere"], x: [115, 125], y: [-138, -117] },
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
    _drawBottomScreenMessage(message);
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
                const hexIndex = hexagon.indexOf(hex); // Get index for threat removal
                // If the eliminated unit is a cannon, remove its threat to prevent "ghost" threats.
                if (hexagon[hexIndex].unit === 4) {
                    gameState.cannonThreats.delete(hexIndex);
                }
                // Update the unit on the main hexagon array.
                hexagon[hexIndex].unit = 0;
                hexagon[hexIndex].team = 0;
                eliminated = true;
            }
        }
        if (eliminated && sounds.boom2) sounds.boom2.play();
    }
}

/**
 * @private
 * Determines the type of unit that will be created on the next level based on zone dominance.
 * It uses a point-based system and also ensures that an existing special unit can carry itself over.
 * @param {number} pointAdvantage - The point value advantage (e.g., player points - enemy points).
 * @param {number} bestPresentUnit - The unit type of the strongest unit already in the zone.
 * @param {number} nextLevel - The level number that the unit will be carried over TO.
 * @returns {number} The unit type (1: Soldier, 2: Archer, 3: Cavalry, 4: Cannon).
 */
function _getCarryoverUnitType(pointAdvantage, bestPresentUnit, nextLevel) {
    let promotedByPoints = 1; // Default to Soldier

    // Determine the best possible unit based on point advantage and level requirements.
    for (const rule of SPECIAL_UNIT_PROMOTION_RULES) {
 // Check if the player has unlocked this unit type by reaching the required level.
        if (pointAdvantage >= rule.pointAdvantage && gameState[rule.unlockFlag]) {
            promotedByPoints = rule.unitType;
            break; // Rules are ordered by priority, so we take the first one we qualify for.
        }
    }

    // The final unit must be at least as strong as the best unit already present.
    // This handles both the "carryover" and "never downgrade" rules.
    if (UNIT_STRENGTH_RANK[bestPresentUnit] > UNIT_STRENGTH_RANK[promotedByPoints]) {
        return bestPresentUnit;
    }
    return promotedByPoints;
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

        const unitAdvantage = playerUnitCount - enemyUnitCount;

        if (unitAdvantage >= 2) { // Player has dominance
            const playerPointValue = playerUnitsInZone.reduce((sum, u) => sum + (UNIT_VALUES[u.unit] || 1), 0);
            const enemyPointValue = enemyUnitsInZone.reduce((sum, u) => sum + (UNIT_VALUES[u.unit] || 1), 0);
            const pointAdvantage = playerPointValue - enemyPointValue;

            let bestPresentUnit = 1;
            if (playerUnitsInZone.length > 0) {
                const bestUnitObject = playerUnitsInZone.reduce((best, current) => {
                    return (UNIT_STRENGTH_RANK[current.unit] || 1) > (UNIT_STRENGTH_RANK[best.unit] || 1) ? current : best;
                });
                bestPresentUnit = bestUnitObject.unit;
            }

            const unitType = _getCarryoverUnitType(pointAdvantage, bestPresentUnit, gameState.level + 1);
            zoneDominance[zone] = { team: PLAYER_TEAM, unitType: unitType };
        } else if (unitAdvantage <= -2) { // Enemy has dominance
            const playerPointValue = playerUnitsInZone.reduce((sum, u) => sum + (UNIT_VALUES[u.unit] || 1), 0);
            const enemyPointValue = enemyUnitsInZone.reduce((sum, u) => sum + (UNIT_VALUES[u.unit] || 1), 0);
            const pointAdvantage = enemyPointValue - playerPointValue;

            const bestPresentUnit = enemyUnitsInZone.length > 0 ?
                enemyUnitsInZone.reduce((best, current) => (UNIT_STRENGTH_RANK[current.unit] || 1) > (UNIT_STRENGTH_RANK[best.unit] || 1) ? current : best).unit :
                1;

            const unitType = _getCarryoverUnitType(pointAdvantage, bestPresentUnit, gameState.level + 1);
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
 * Defines the possible unit compositions when "zooming in" on a hex.
 * The outcomes are based on the unit type being zoomed into, providing a
 * point-based advantage to the owner of that unit.
 */
const ZOOM_IN_UNIT_CONFIG = {
    // Neutral Hex (unit: 0) -> Slight enemy advantage
    0: {
        options: [
            { value: { player: { soldiers: 2 }, enemy: { soldiers: 3 } }, weight: 4 },
            { value: { player: { soldiers: 1 }, enemy: { soldiers: 2 } }, weight: 2 },
            { value: { player: { soldiers: 2 }, enemy: { soldiers: 4 } }, weight: 2 },
            { value: { player: { soldiers: 0 }, enemy: { soldiers: 1 } }, weight: 1 }
        ]
    },
    // Soldier Hex (unit: 1) -> ~+1 unit advantage for owner
    1: {
        // Options for when the PLAYER owns the soldier
        player: [
            { value: { player: { soldiers: 3 }, enemy: { soldiers: 2 } }, weight: 4 },
            { value: { player: { soldiers: 2 }, enemy: { soldiers: 1 } }, weight: 3 },
            { value: { player: { soldiers: 4 }, enemy: { soldiers: 2 } }, weight: 2 },
            { value: { player: { soldiers: 1 }, enemy: { soldiers: 0 } }, weight: 1 }
        ],
        // Options for when the ENEMY owns the soldier
        enemy: [
            { value: { player: { soldiers: 2 }, enemy: { soldiers: 3 } }, weight: 4 },
            { value: { player: { soldiers: 1 }, enemy: { soldiers: 2 } }, weight: 3 },
            { value: { player: { soldiers: 2 }, enemy: { soldiers: 4 } }, weight: 2 },
            { value: { player: { soldiers: 0 }, enemy: { soldiers: 1 } }, weight: 1 }
        ]
    },
    // Archer Hex (unit: 2) -> ~+2.5-4 point advantage for owner
    2: { // Archer
        options: [
            { value: { player: { soldiers: 5 }, enemy: { soldiers: 1 } }, weight: 4 },
            { value: { player: { soldiers: 2, cavalry: 1 }, enemy: { soldiers: 1 } }, weight: 3, unlockFlag: 'hasBeenOnLevel2' },
            { value: { player: { archers: 1, soldiers: 1 }, enemy: { soldiers: 1 } }, weight: 5 },
            { value: { player: { cannons: 1, soldiers: 1 }, enemy: { soldiers: 1 } }, weight: 2, unlockFlag: 'hasBeenOnLevel5' }
        ]
    },
    // Cavalry Hex (unit: 3) -> ~+1.5-2 point advantage for owner
    3: { // Cavalry
        options: [
            { value: { player: { soldiers: 3 }, enemy: { soldiers: 1 } }, weight: 4 },
            { value: { player: { cavalry: 1, soldiers: 1 }, enemy: { soldiers: 1 } }, weight: 5 }
        ]
    },
    // Cannon Hex (unit: 4) -> ~+2-3 point advantage for owner
    4: { // Cannon
        options: [
            { value: { player: { soldiers: 4 }, enemy: { soldiers: 1 } }, weight: 4 },
            { value: { player: { soldiers: 2, cavalry: 1 }, enemy: { soldiers: 1 } }, weight: 3, unlockFlag: 'hasBeenOnLevel2' },
            { value: { player: { cannons: 1, soldiers: 1 }, enemy: { soldiers: 1 } }, weight: 5 }
        ]
    }
};
/**
 * Generates the board state for a new, lower level by "zooming in" on a
 * specific zone from the current level.
 * @param {number} sourceZone - The zone number from the current level to zoom into.
 * @returns {Array<{unit: number, team: number}>} An array representing the full board state.
 */
function generateZoomInBoard(sourceZone) {
    const boardState = Array(hexagon.length).fill(null).map(() => ({ unit: 0, team: 0 }));

    // 1. Get the hexes from the source zone that we are zooming into.
    const sourceHexes = hexesByZone.get(sourceZone);

    // 2. Populate the new board zone by zone, using the pre-defined `mapsToNewZone` property.
    for (const sourceHex of sourceHexes) {
        const newZoneNum = sourceHex.mapsToNewZone;
        if (!newZoneNum) continue; // Should not happen, but a good safeguard.

        const hexesInNewZone = hexesByZone.get(newZoneNum).map(h => hexagon.indexOf(h));
        const unitConfig = ZOOM_IN_UNIT_CONFIG[sourceHex.unit];
        if (!unitConfig) continue;

        let finalPackage;
        if (sourceHex.unit === 0) { // Neutral hex
            finalPackage = getWeightedRandom(unitConfig.options);
        } else if (sourceHex.unit === 1) { // Soldier hex
            const options = (sourceHex.team === PLAYER_TEAM) ? unitConfig.player : unitConfig.enemy;
            finalPackage = getWeightedRandom(options);
        } else { // Special unit hex (Archer, Cavalry, Cannon)
            const validOptions = unitConfig.options.filter(opt => !opt.unlockFlag || gameState[opt.unlockFlag]);
            const basePackage = getWeightedRandom(validOptions).value;
            if (sourceHex.team === PLAYER_TEAM) {
                finalPackage = basePackage;
            } else { // It's an AI special unit, so swap the player/enemy rewards
                finalPackage = { player: basePackage.enemy, enemy: basePackage.player };
                finalPackage.enemy.soldiers = (finalPackage.enemy.soldiers || 0);
                finalPackage.enemy.soldiers += 2;
            }
        }

        // Create a pool of units based on the chosen package.
        const unitPool = [];
        const addUnitsToPool = (team, package) => {
            for (let i = 0; i < (package.soldiers || 0); i++) unitPool.push({ unit: 1, team: team });
            for (let i = 0; i < (package.archers || 0); i++) unitPool.push({ unit: 2, team: team });
            for (let i = 0; i < (package.cavalry || 0); i++) unitPool.push({ unit: 3, team: team });
            for (let i = 0; i < (package.cannons || 0); i++) unitPool.push({ unit: 4, team: team });
        };

        addUnitsToPool(PLAYER_TEAM, finalPackage.player || {});
        addUnitsToPool(ENEMY_TEAM, finalPackage.enemy || {});

        // Fill the rest of the zone with empty hexes.
        while (unitPool.length < hexesInNewZone.length) unitPool.push({ unit: 0, team: 0 });

        shuffle(unitPool, true);

        // Place the units on the board.
        for (let i = 0; i < hexesInNewZone.length; i++) {
            boardState[hexesInNewZone[i]] = unitPool[i];
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
    gameState = { ...gameState, selected: -1, badClick: 0, zonesMovedFromThisTurn: new Set(), endTurn: 0, isPlayerTurn: true, aiMoveQueue: [], aiZonesMovedFromThisTurn: new Set(), animationLoop: 0, animateMovementFrom: null, animateMovementTo: null, level: 1, playerTurnCount: 1, secretArcherZone: floor(random(6)) + 1, cannonsThatTargetedThisTurn: new Set(), cannonThreats: new Map(), animateCannonThreat: null };

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
                } else if (neighborHex.unit === 4) { // It's a cannon!
                    score += AI_SCORING_WEIGHTS.KILL_CANNON_BONUS;
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
    // 1. Add a large base score to ensure targeting is always prioritized.
    score += AI_SCORING_WEIGHTS.CANNON_TARGET_ACTION_BONUS;

    // 2. Add a small random value to break ties between equally bad/good options.
    score += random(AI_SCORING_WEIGHTS.RANDOM_TIEBREAK / 2);

    // 3. Add a bonus for the size of the target group.
    // This encourages the AI to pick 3-hex targets over 1 or 2-hex targets.
    score += targetGroup.length * AI_SCORING_WEIGHTS.TARGET_GROUP_SIZE_BONUS;

    let directHits = 0;
    for (const hexIndex of targetGroup) {
        const hex = hexagon[hexIndex];
        if (hex.team === PLAYER_TEAM) {
            directHits++;
            // Use CREATE_KILL as a base score for hitting any unit.
            score += AI_SCORING_WEIGHTS.CREATE_KILL;
            // Add bonuses for high-value targets.
            if (hex.unit === 2) score += AI_SCORING_WEIGHTS.KILL_ARCHER_BONUS;
            if (hex.unit === 4) score += AI_SCORING_WEIGHTS.KILL_CANNON_BONUS;
            if (hex.unit === 3) score += AI_SCORING_WEIGHTS.KILL_CAVALRY_BONUS;
        }
    }

    // 4. If there are no direct hits, score based on proximity to player units.
    if (directHits === 0) {
        let proximityScore = 0;
        const checkedNeighbors = new Set(); // To avoid double-counting proximity to the same unit
        for (const hexIndex of targetGroup) {
            // Check neighbors of each hex in the blast radius
            const neighbors = getHexesInRange(hexIndex, 1);
            for (const neighborIndex of neighbors) {
                if (hexagon[neighborIndex].team === PLAYER_TEAM && !checkedNeighbors.has(neighborIndex)) {
                    // Use the "setup kill" weight for proximity, as it represents a threat.
                    proximityScore += AI_SCORING_WEIGHTS.SETUP_KILL;
                    checkedNeighbors.add(neighborIndex);
                }
            }
        }
        score += proximityScore;
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
        // const teamName = (team === PLAYER_TEAM) ? "player" : "enemy";
        // console.log(`Converted ${teamName} soldier at hex ${hexIndexToConvert} to a ${unitTypeName}.`);
    } else {
        // const teamName = (team === PLAYER_TEAM) ? "player" : "enemy";
        // console.log(`No ${teamName} soldiers found to convert to ${unitTypeName} (excluding zone ${excludedZone}).`);
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
 */function findBestAIMove() {
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
            if (sourceHex.unit === 4 && !gameState.cannonsThatTargetedThisTurn.has(i)) {
                // Iterate through the 12 possible firing directions. This is more efficient
                // and consistent with the player's targeting UI.
                for (let directionIndex = 0; directionIndex < 12; directionIndex++) {
                    const targetGroup = _calculateCannonTargetGroupFromDirection(i, directionIndex);
                    if (targetGroup.length > 0) {
                        const score = evaluateThreatAction(i, targetGroup);
                        if (score > bestMove.score) {
                            // Store the directionIndex instead of the aimingIndex.
                            bestMove = { from: i, to: -1, score: score, type: 'set_threat', directionIndex: directionIndex };
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
 * @param {object} move - The move to execute.
 */
function executeAIMove(move) {
    // Handle the "set threat" action type for cannons by triggering an animation.
    if (move.type === 'set_threat') {
        // Recalculate the target group using the stored direction to ensure it's accurate.
        const targetGroup = _calculateCannonTargetGroupFromDirection(move.from, move.directionIndex);
        
        const duration = 60 * getZoomAnimationSpeedMultiplier();
        // We now pass the directionIndex directly.
        gameState.animateCannonThreat = { cannonIndex: move.from, targetGroup: targetGroup, directionIndex: move.directionIndex, duration: duration };
        // Mark the cannon as having fired this turn to prevent it from being used again.
        gameState.cannonsThatTargetedThisTurn.add(move.from);
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

    // If a cannon with an active threat moves, transfer the threat to the new location.
    _moveCannonThreat(move.from, move.to);

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
        // If the unit being removed is a cannon, we must also remove its threat area
        // from the game state to prevent "ghost" threats on future turns.
        if (hexagon[hexIndex].unit === 4) {
            gameState.cannonThreats.delete(hexIndex);
        }
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
   // Seed the AI with special units based on what the player has unlocked,
    // making the board composition dependent on the player's progress.
    if (gameState.hasBeenOnLevel3) {
        _convertRandomSoldier(board, ENEMY_TEAM, 2, 'archer', excludedZone);
    }
  if (gameState.hasBeenOnLevel2) {
        _convertRandomSoldier(board, ENEMY_TEAM, 3, 'cavalry', excludedZone);
    }
    if (gameState.hasBeenOnLevel5) {
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
    endTurnButton = new Button(width - edgeMargin, height - edgeMargin, mainButtonRadius, "End", "Turn", 'none', 'rectangle');
    // debugSkipLevelButton = new Button(endTurnButton.x, endTurnButton.y - mainButtonRadius * 2 - buttonSpacing, mainButtonRadius, "Skip to", "Level 5"); // DEBUG
    zoomOutButton = new Button(edgeMargin, edgeMargin, mainButtonRadius, "Zoom", "Out", 'out');
    zoomInButton = new Button(edgeMargin, edgeMargin + mainButtonRadius * 2 + buttonSpacing, mainButtonRadius, "Zoom", "In", 'in');
    mainMenuButton = new Button(width - edgeMargin, edgeMargin, mainButtonRadius, "Options", null, 'none', 'rectangle');

    // Intro and Instructions Screen Buttons. Renamed for clarity.
    newGameButton = new Button(width - edgeMargin, height - edgeMargin, mainButtonRadius, "Continue", null, 'none', 'rectangle');
    startButton = new Button(width - edgeMargin, height - edgeMargin, mainButtonRadius, "Start", null, 'none', 'rectangle');

    // Options Screen Buttons
    optionsNewGameButton = new Button(width - edgeMargin, height - edgeMargin, mainButtonRadius, "New", "Game", 'none', 'rectangle');
    // Position the "Back" button to the left of the "New Game" button at the bottom of the screen.
    const backButtonX = optionsNewGameButton.x - (mainButtonRadius * 2) - buttonSpacing;
    const backButtonY = optionsNewGameButton.y;
    optionsBackButton = new Button(backButtonX, backButtonY, mainButtonRadius, "Back", "to Game", 'none', 'rectangle');

// --- Instantiate Option Controls ---
const controlCenterX = width / 2;
const controlBlockCenterY = height / 2; // Center the block vertically to create space from the title
const controlSpacing = 100 * boardScale;

// Position the controls in a vertical stack.
const volumeY = controlBlockCenterY - controlSpacing;
const moveAnimY = controlBlockCenterY;
const zoomAnimY = controlBlockCenterY + controlSpacing;

// Zoom Animation Control
zoomAnimationControl = new OptionControl(
    "Zoom Animation",
    controlCenterX,
    zoomAnimY,
    () => ANIMATION_SPEED_CONFIG[gameState.zoomAnimationSpeedSetting].label,
    (direction) => {
        const numSettings = ANIMATION_SPEED_CONFIG.length;
        const current = gameState.zoomAnimationSpeedSetting;
        if (direction === 'up') {
            gameState.zoomAnimationSpeedSetting = (current + 1) % numSettings;
        } else { // 'down'
            gameState.zoomAnimationSpeedSetting = (current - 1 + numSettings) % numSettings;
        }
        // No need to call an update function, the multiplier is read live.
    }
);

// Movement Animation Control
movementAnimationControl = new OptionControl(
    "Move Animation",
    controlCenterX,
    moveAnimY,
    () => ANIMATION_SPEED_CONFIG[gameState.movementAnimationSpeedSetting].label,
    (direction) => {
        const numSettings = ANIMATION_SPEED_CONFIG.length;
        const current = gameState.movementAnimationSpeedSetting;
        if (direction === 'up') {
            gameState.movementAnimationSpeedSetting = (current + 1) % numSettings;
        } else { // 'down'
            gameState.movementAnimationSpeedSetting = (current - 1 + numSettings) % numSettings;
        }
        updateAnimationSpeed(); // This updates the global animation loop size.
    }
);

volumeControl = new OptionControl(
    "Volume",
    controlCenterX,
    volumeY,
    () => String(gameState.masterVolume),
    (direction) => {
        if (direction === 'up') {
            gameState.masterVolume = min(gameState.masterVolume + 1, 10);
        } else { // 'down'
            gameState.masterVolume = max(gameState.masterVolume - 1, 0);
        }
        updateMasterVolume();
    }
);

    // Difficulty adjustment control for the intro screen
    const difficultyControlX = 200 * boardScale;
    const difficultyControlY = height - edgeMargin;
    difficultyControl = new OptionControl(
        "Difficulty",
        difficultyControlX,
        difficultyControlY,
        () => DIFFICULTY_LABELS[gameState.introScreenDifficulty],
        (direction) => {
            if (direction === 'up') {
                gameState.introScreenDifficulty = min(gameState.introScreenDifficulty + 1, 10);
            } else { // 'down'
                gameState.introScreenDifficulty = max(gameState.introScreenDifficulty - 1, -5);
            }
        }
    );

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

    // --- Dynamically generate cannon aiming constants based on grid geometry ---
    // This ensures that the angles and coordinate offsets are perfectly synchronized.

    // 1. Find a central hex to use as a reference point. Hex 24 (in Zone 7) is a good choice.
    const referenceHexIndex = 24;
    const referenceHex = hexagon[referenceHexIndex];
    const referencePos = hexToXY(referenceHex.xHex, referenceHex.yHex);

    // 2. Get all hexes in the cannon's firing ring (range 2, excluding range 1).
    const hexesAtRange1 = getHexesInRange(referenceHexIndex, 1);
    const hexesAtRange2 = getHexesInRange(referenceHexIndex, 2);
    const firingRingHexes = hexesAtRange2
        .filter(hIndex => !hexesAtRange1.includes(hIndex))
        .map(hIndex => ({
            index: hIndex,
            hex: hexagon[hIndex],
            pos: hexToXY(hexagon[hIndex].xHex, hexagon[hIndex].yHex)
        }));

    // 3. Calculate the angle of each hex in the ring relative to the reference hex.
    for (const ringHex of firingRingHexes) {
        ringHex.angle = atan2(ringHex.pos.y - referencePos.y, ringHex.pos.x - referencePos.x);
    }

    // 4. Sort the hexes by angle to ensure a consistent 0-11 direction index.
    firingRingHexes.sort((a, b) => a.angle - b.angle);

    // 5. Generate the final constant arrays from the sorted list.
    CANNON_DIRECTIONS = firingRingHexes.map(rh => rh.angle);
    CANNON_AIM_OFFSETS = firingRingHexes.map(rh => ({
        dx: rh.hex.xHex - referenceHex.xHex,
        dy: rh.hex.yHex - referenceHex.yHex
    }));

    // Initialize the animation state machines BEFORE loading the game state.
    // This ensures that a loaded state can correctly overwrite the defaults.
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

    // Load the game state if it exists. If a valid state is loaded,
    // the game will resume. Otherwise, it will start on the intro screen.
    loadGameState();
    // --- Pre-calculate hexagon lookups by zone for efficiency ---
    for (let i = 1; i <= 7; i++) {
        hexesByZone.set(i, []);
    }
    for (let i = 0; i < hexagon.length; i++) {
        hexesByZone.get(hexagon[i].zone).push(hexagon[i]);
    }
    precalculateHexRanges(); // One-time calculation for performance
    precalculateCoordMap();
    updateAnimationSpeed(); // Set animation speed based on loaded or default state.

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

    teamColors = [
        {mainColor: color(245, 8, 8), secondaryColor: color(47, 0, 255)}, //dummy
        {mainColor: color(8, 8, 8), secondaryColor: color(232, 225, 225)}, //player1
        {mainColor: color(161, 3, 3), secondaryColor: color(7, 176, 100)}  //player2(or AI)
    ];

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

    // Difficulty Control
    if (difficultyControl) difficultyControl.draw();

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
 * Draws the options screen.
 */
function drawOptionsScreen() {
    push();
    translate(width / 2, height / 2);

    // Title
    textAlign(CENTER, CENTER);
    fill(0);
    textStyle(BOLD);
    textSize(50 * boardScale);
    text("Options", 0, -height * 0.35);
    textStyle(NORMAL);

    // Draw the screen's buttons.
    // The button's draw method handles converting its absolute coords to relative ones.
    optionsBackButton.draw(true);
    optionsNewGameButton.draw(true);

    // Draw the new OptionControl instances
    if (movementAnimationControl) movementAnimationControl.draw();
    if (zoomAnimationControl) zoomAnimationControl.draw();
    if (volumeControl) volumeControl.draw();

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
                drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team, i);
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
    const multiplier = getZoomAnimationSpeedMultiplier();
    switch (zoomOutAnimationState.phase) {
        case 'shrinking':
            const shrinkDuration = 60 * multiplier;
            zoomOutAnimationState.progress += 1 / shrinkDuration;
            if (zoomOutAnimationState.progress >= 1) {
                zoomOutAnimationState.progress = 1;
                zoomOutAnimationState.phase = 'paused';
                zoomOutAnimationState.pauseTimer = 30 * multiplier;
            }
            break;
        case 'paused':
            zoomOutAnimationState.pauseTimer--;
            if (zoomOutAnimationState.pauseTimer <= 0) {
                zoomOutAnimationState.phase = 'revealing';
                zoomOutAnimationState.revealTimer = 30 * multiplier;
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
                    zoomOutAnimationState.revealTimer = 30 * multiplier; // Reset timer for next reveal
                } else {
                    zoomOutAnimationState.phase = 'recoloring_pause';
                    zoomOutAnimationState.revealTimer = 30 * multiplier; // "one more beat"
                }
            }
            break;
        case 'recoloring_pause':
            zoomOutAnimationState.revealTimer--;
            if (zoomOutAnimationState.revealTimer <= 0) {
                // Pause is over. The next draw will use the new colors.
                // TODO: Maybe play a sound for the recolor.
                zoomOutAnimationState.phase = 'final_reveal';
                zoomOutAnimationState.revealTimer = 30 * multiplier; // Beat before outer zones appear.
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
                zoomOutAnimationState.revealTimer = 60 * multiplier; // Show final board for 1 second.
            }
            break;
        case 'complete':
            zoomOutAnimationState.revealTimer--;
            if (zoomOutAnimationState.revealTimer <= 0) {
                // Final pause is over. Reset for the next level. // prettier-ignore
                const nextLevel = gameState.level + 1;
                gameState = { ...gameState, selected: -1, badClick: 0, zonesMovedFromThisTurn: new Set(), endTurn: 0, isPlayerTurn: true, aiMoveQueue: [], aiZonesMovedFromThisTurn: new Set(), animationLoop: 0, animateMovementFrom: null, animateMovementTo: null, level: nextLevel, playerTurnCount: 1, secretArcherZone: floor(random(6)) + 1, cannonsThatTargetedThisTurn: new Set(), cannonThreats: new Map(), animateCannonThreat: null };
                zoomOutAnimationState.phase = 'inactive';
                saveGameState(); // Save the new level state immediately
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
    mainMenuButton.draw(true); // Always available

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
        // debugSkipLevelButton.draw(true); // DEBUG
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
            // Only increment the move counter for physical moves, not for setting a threat.
            if (bestMove.type !== 'set_threat') {
                gameState.aiMovesMadeThisTurn++;
            }
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

    // 2. Apply a center translation and rotation to the entire scene
    push(); // Save the current drawing state
    translate(width / 2, height / 2);
    rotate(gameState.winRotation);

    // 3. Draw the game board underneath, scaled relative to the new center origin
    push();
    scale(boardScale);
    drawGameBoard();
    drawAllUnits();
    pop();

    // 4. Draw the "You Win!" text on top
    // Coordinates are now relative to the screen's center.
    const textX1 = -width / 2 + 50 * boardScale;
    const textY1 = -height / 2 + 50 * boardScale;
    const textX2 = width / 2 - 50 * boardScale;
    const textY2 = height / 2 - 50 * boardScale;

    fill(170, 0, 120); // Same color as "Zoom:" title
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(200 * boardScale);
    text("You", textX1, textY1);
    textAlign(RIGHT, BOTTOM);
    text("Win!", textX2, textY2);
    textStyle(NORMAL); // Reset text style

    // Draw the "New Game" button, which will rotate with the screen
    if (mainMenuButton) {
        mainMenuButton.draw(true);
    }

    // 5. Restore the drawing state from the rotation
    pop();
}

/**
 * Draws the flashing animation for an AI cannon setting a threat.
 * This function also handles the state transition after the animation completes,
 * setting the permanent threat on the board.
 */
function drawCannonThreatAnimation() {
    if (!gameState.animateCannonThreat) return;

    const { cannonIndex, targetGroup, duration } = gameState.animateCannonThreat;

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
        _setCannonThreat(cannonIndex, gameState.animateCannonThreat.directionIndex);
        // Play the same confirmation sound as the player's cannon for consistency.
        if (sounds.select) sounds.select.play();
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
        // Determine the hovered zone before drawing the board, so the highlight can be passed down.
        // Use findClosestHexToMouse instead of findClickedHex to prevent "blinking" between hexes.
        const hoveredHexIndex = findClosestHexToMouse();
        const hoveredZone = gameState.zoneSelectionMode && hoveredHexIndex !== -1 ? hexagon[hoveredHexIndex].zone : null;

        drawGameBoard(hoveredZone);
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
    } else if (gameState.currentScreen === 'options') {
        drawOptionsScreen();
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
        drawUnit(newHex.xHex, newHex.yHex, newHexState.unit, newHexState.team, newHexIndex);
    }

    // The final reveal of outer zones happens once the 'complete' phase begins.
    const showOuterZones = (zoomOutAnimationState.phase === 'complete');

    if (showOuterZones) {
        for (let i = 0; i < hexagon.length; i++) {
            if (hexagon[i].zone !== zoomOutAnimationState.targetZoneForReveal) {
                const hex = hexagon[i];
                // The outer zones use their own default colors, so no override is needed.
                hex.draw(i, null);
                drawUnit(hex.xHex, hex.yHex, zoomOutAnimationState.nextLevelBoard[i].unit, zoomOutAnimationState.nextLevelBoard[i].team, i);
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
    const multiplier = getZoomAnimationSpeedMultiplier();
    const fadeDuration = 30 * multiplier;
    const expandDuration = 60 * multiplier;

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
            zoomInAnimationState.recolorTimer = 30 * multiplier; // Wait ~0.5s before starting the recolor
        }
    } else if (zoomInAnimationState.phase === 'recoloring') {
        zoomInAnimationState.recolorTimer--;
        if (zoomInAnimationState.recolorTimer <= 0 && zoomInAnimationState.recoloredHexes < 7) {
            zoomInAnimationState.recoloredHexes++;
            zoomInAnimationState.recolorTimer = 30 * multiplier; // ~0.5 second delay at 60fps
            if (sounds.select) sounds.select.play();
        } else if (zoomInAnimationState.recoloredHexes >= 7 && zoomInAnimationState.recolorTimer <= 0) {
            // Transition to the next phase after a short pause
            zoomInAnimationState.phase = 'revealing';
            zoomInAnimationState.recoloredHexes = 0; // Reuse this counter for the reveal
            zoomInAnimationState.recolorTimer = 30 * multiplier; // Initial pause before first reveal
        }
    } else if (zoomInAnimationState.phase === 'revealing') {
        zoomInAnimationState.recolorTimer--;
        if (zoomInAnimationState.recolorTimer <= 0 && zoomInAnimationState.recoloredHexes < 7) {
            zoomInAnimationState.recoloredHexes++; // This now means "revealed new zones"
            zoomInAnimationState.recolorTimer = 15 * multiplier; // A shorter delay between each zone reveal
            if (sounds.boom2) sounds.boom2.play();
        } else if (zoomInAnimationState.recoloredHexes >= 7 && zoomInAnimationState.recolorTimer <= 0) {
            // All new zones are revealed. Transition to the final step.
            zoomInAnimationState.phase = 'finalizing';
            zoomInAnimationState.recolorTimer = 60 * multiplier; // Pause to show the full new board
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
            const nextLevel = gameState.level - 1; // prettier-ignore
            gameState = { ...gameState, selected: -1, badClick: 0, zonesMovedFromThisTurn: new Set(), endTurn: 0, isPlayerTurn: true, aiMoveQueue: [], aiZonesMovedFromThisTurn: new Set(), animationLoop: 0, animateMovementFrom: null, animateMovementTo: null, level: nextLevel, playerTurnCount: 1, secretArcherZone: floor(random(6)) + 1, zoneSelectionMode: false, selectedZone: null, cannonsThatTargetedThisTurn: new Set(), cannonThreats: new Map(), animateCannonThreat: null };
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
                drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team, i);
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
            drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team, hexagon.indexOf(hex));
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
            drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team, hexIndex);
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
                    drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team, item.hexIndex);
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
                drawUnit(hex.xHex, hex.yHex, hexState.unit, hexState.team, hexIndex);
            }
        }
    } else if (zoomInAnimationState.phase === 'finalizing') {
        // This phase draws the complete new board state as a preview before control is returned.
        for (let i = 0; i < hexagon.length; i++) {
            const hex = hexagon[i];
            const hexState = zoomInAnimationState.precalculatedBoard[i];
            // Draw the hex with its final, correct zone color.
            hex.draw(i);
            drawUnit(hex.xHex, hex.yHex, hexState.unit, hexState.team, i);
        }
    }
}

function drawGameBoard(hoveredZone = null) {
    for (let i = 0; i < hexagon.length; i++) {
        const hex = hexagon[i];
        hex.draw(i, null, hoveredZone);
        // hex.showCoordinates(i);
    }
}

function drawAllUnits() {
    for (let i = 0; i < hexagon.length; i++) {
        // Don't draw the unit at the animation's destination,
        // because the drawAnimation() function is handling it.
        if (i !== gameState.animateMovementTo) {
            const hex = hexagon[i];
            drawUnit(hex.xHex, hex.yHex, hex.unit, hex.team, i);
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
    const toIndex = hexagon.indexOf(to);
    drawFunc(currentX, currentY, to.unit, to.team, toIndex);

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
    // Calculate the scaled mouse coordinates once, before the loop, to avoid
    // redundant calculations inside the check for every single hex.
    const translatedMouseX = mouseX - (width / 2);
    const translatedMouseY = mouseY - (height / 2);
    const scaledMouseX = translatedMouseX / boardScale;
    const scaledMouseY = translatedMouseY / boardScale;

    for (let i = 0; i < hexagon.length; i++) {
        if (_isClickInCircle(scaledMouseX, scaledMouseY, hexagon[i])) {
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

    // Define a maximum distance threshold. If the closest hex is still too far,
    // treat it as if no hex was found. This prevents highlighting when the mouse
    // is far from the board. A distance of 1.5 * r is a reasonable "tiny distance".
    const maxDistance = r * 1.1;
    if (minDistanceSq > maxDistance * maxDistance) {
        return -1;
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
        const hasMovedFromZone = gameState.zonesMovedFromThisTurn.has(clickedHex.zone); // prettier-ignore
        const isCannon = clickedHex.unit === 4;
        const hasCannonTargeted = gameState.cannonsThatTargetedThisTurn.has(clickedIndex);

        // Special case: Allow selecting a cannon to set its threat, even if its zone has been used for a move.
        if (isCannon && !hasCannonTargeted) {
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
            gameState.lockedAimingDirectionIndex = null;
            // The highlight will be recalculated on the next draw frame.
            return true; // Action handled: canceled aiming.
        }

        const newAimingDirectionIndex = _getDirectionFromMouse(gameState.selected);
        if (newAimingDirectionIndex === gameState.lockedAimingDirectionIndex) {
            // --- CONFIRM & SET THREAT ---
            // The user clicked in the same direction again. Confirm the target.
            _setCannonThreat(gameState.selected, gameState.lockedAimingDirectionIndex);

            if (sounds.select) sounds.select.play();
            // Reset all selection and aiming state.
            gameState.selected = -1;
            gameState.validMoves.clear();
            gameState.potentialCannonTargets = [];
            gameState.highlightedCannonTargetGroup = null;
            gameState.lastAimingDirectionIndex = null;
            gameState.cannonIsAiming = false;
            gameState.lockedAimingDirectionIndex = null;
            return true; // Action handled: threat set.
        } else {
            // --- RE-AIM ---
            // The user clicked a different direction. Update the aim.
            gameState.lockedAimingDirectionIndex = newAimingDirectionIndex;
            gameState.highlightedCannonTargetGroup = _calculateCannonTargetGroupFromDirection(gameState.selected, newAimingDirectionIndex);
            // If the new aim is invalid (no targets), cancel aiming mode.
            if (gameState.highlightedCannonTargetGroup.length === 0) {
                gameState.cannonIsAiming = false;
                gameState.lockedAimingDirectionIndex = null;
            }
            return true; // Action handled: re-aimed.
        }
    } else if (gameState.highlightedCannonTargetGroup && gameState.highlightedCannonTargetGroup.length > 0) {
        // --- ENTER AIMING MODE ---
        // A first click on a valid target area locks the aim.
        gameState.cannonIsAiming = true;
        gameState.lockedAimingDirectionIndex = gameState.lastAimingDirectionIndex;
        // The highlighted group is already set by the UI, so it's now "locked".
        return true; // Action handled: entered aiming mode.
    }
    // If we reach here, no cannon-specific action was taken. The click might be a move.
    return false;
}

/**
 * Handles a click when a unit is already selected. This function determines
 * whether the click corresponds to a valid move, a re-selection of another
 * friendly unit, or an invalid action that should deselect the unit.
 * @param {number} clickedIndex - The index of the hex that was clicked.
 */
function handleMoveUnit(clickedIndex) {
    const selectedHex = hexagon[gameState.selected];

    // If the player clicks the already-selected unit, deselect it.
    // This provides a consistent way to cancel an action.
    if (clickedIndex === gameState.selected) {
        if (sounds.select) sounds.select.play();
        gameState.selected = -1;
        gameState.validMoves.clear();
        gameState.potentialCannonTargets = [];
        gameState.highlightedCannonTargetGroup = null;
        gameState.cannonIsAiming = false;
        gameState.lockedAimingDirectionIndex = null;
        gameState.badClick = 0; // Clear any previous error messages
        return; // Action is complete.
    }

    // 1. Check for a valid move to an empty hex. This has the highest priority.
    if (clickedIndex !== -1 && gameState.validMoves.has(clickedIndex)) {
        if (sounds.move) sounds.move.play();
        const sourceHex = hexagon[gameState.selected]; // prettier-ignore
        const destinationHex = hexagon[clickedIndex]; // prettier-ignore

        // If a cannon with an active threat moves, transfer the threat to the new location.
        _moveCannonThreat(gameState.selected, clickedIndex);

        // Execute the move.
        gameState.zonesMovedFromThisTurn.add(sourceHex.zone);
        destinationHex.unit = sourceHex.unit;
        destinationHex.team = sourceHex.team;
        sourceHex.unit = 0;
        sourceHex.team = 0;
        gameState.animateMovementFrom = gameState.selected;
        gameState.animateMovementTo = clickedIndex;
        // Reset selection state.
        gameState.selected = -1;
        gameState.validMoves.clear();
        gameState.potentialCannonTargets = [];
        gameState.highlightedCannonTargetGroup = null;
        gameState.cannonIsAiming = false;
        gameState.lockedAimingDirectionIndex = null;
    }
    // 2. If it's not a valid move, check for other actions.
    else if (selectedHex.unit === 4 && _handleCannonAction(clickedIndex)) {
        // A cannon-specific action (like aiming) was performed.
        // The _handleCannonAction function takes care of state changes, so we just return.
        return;
    } else if (clickedIndex !== -1 && hexagon[clickedIndex].team === PLAYER_TEAM) {
        // 3. Clicked on another friendly unit. Reselect it.
        handleSelectUnit(clickedIndex);
    } else {
        // 4. Invalid click (empty space, enemy unit, etc.). Deselect the current unit.
        if (sounds.error) sounds.error.play();
        gameState.badClick = 3; // "Can't go there"
        gameState.selected = -1;
        gameState.validMoves.clear();
        gameState.potentialCannonTargets = [];
        gameState.highlightedCannonTargetGroup = null;
        gameState.cannonIsAiming = false;
        gameState.lockedAimingDirectionIndex = null;
    }
}

/**
 * Handles the logic for selecting a zone on the game board.
 * This function is currently dormant and not integrated into the main game loop.
 * @param {number} clickedIndex - The index of the hex that was clicked.
 */
function handleZoneSelection(clickedIndex) {
    const clickedHex = hexagon[clickedIndex];
    const clickedZone = clickedHex.zone;

    // --- This function now immediately triggers the zoom-in animation ---
    zoomInAnimationState.phase = 'fading_out';
    zoomInAnimationState.progress = 0;
    zoomInAnimationState.sourceZone = clickedZone;

    const sourceHexes = hexesByZone.get(clickedZone);
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

    zoomInAnimationState.precalculatedBoard = generateZoomInBoard(clickedZone);

    if (sounds.boom1) sounds.boom1.play();

    // Save the state immediately after configuring the animation.
    saveGameState();

    // Exit zone selection mode now that the action is complete.
    gameState.zoneSelectionMode = false;
    gameState.selectedZone = null;
    gameState.badClick = 0; // Clear any messages
}

/**
 * Handles a click on the final "You Win!" screen, specifically for the
 * rotating "New Game" button.
 * @returns {boolean} True if the button was clicked and handled, false otherwise.
 */
function handleWinScreenClick() {
    if (!gameState.gameWon || !mainMenuButton) return false;

    // Inverse transform mouse coordinates to check against the button's static position
    const mx = mouseX - width / 2;
    const my = mouseY - height / 2;
    const angle = -gameState.winRotation;
    const rotatedX = mx * cos(angle) - my * sin(angle);
    const rotatedY = mx * sin(angle) + my * cos(angle);
    const finalX = rotatedX + width / 2;
    const finalY = rotatedY + height / 2;

    // Check if the transformed click is inside the button's original position
    if (dist(finalX, finalY, mainMenuButton.x, mainMenuButton.y) < (mainMenuButton.radius * 13 / 16)) {
        gameState = createDefaultGameState();
        localStorage.removeItem('zoomBftmSaveState');
        console.log("New game started. Previous save state cleared.");
        return true;
    }
    return false;
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
        // Handle difficulty control clicks
        if (difficultyControl && difficultyControl.handleClicks()) {
            return;
        }
    } else if (gameState.currentScreen === 'instructions') {
        if (startButton.pressed()) {
            // Set the game's DIFFICULTY based on the intro screen setting.
            DIFFICULTY = gameState.introScreenDifficulty;
            console.log(`Initial DIFFICULTY set to: ${DIFFICULTY}`); // Debugging
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
    // if (debugSkipLevelButton && debugSkipLevelButton.pressed() && gameState.isPlayerTurn) { // prettier-ignore
    //     // --- Skip directly to level 5 without animation --- // prettier-ignore
    //     console.log("DEBUG: Skipping directly to Level 5.");
    //     
    //     // 1. Set the game state for the new level FIRST so that board generation has the correct context. // prettier-ignore
    //     gameState = { ...gameState, selected: -1, badClick: 0, zonesMovedFromThisTurn: new Set(), endTurn: 0, isPlayerTurn: true, aiMoveQueue: [], aiZonesMovedFromThisTurn: new Set(), animationLoop: 0, animateMovementFrom: null, animateMovementTo: null, level: 5, playerTurnCount: 1, secretArcherZone: floor(random(6)) + 1, zoneSelectionMode: false, selectedZone: null, cannonsThatTargetedThisTurn: new Set(), cannonThreats: new Map(), animateCannonThreat: null };
    //     DIFFICULTY = 4; // Level 5 difficulty is 4

    //     // 2. Generate the new board state.
    //     const newBoard = [];
    //     for (let i = 0; i < hexagon.length; i++) {
    //         newBoard[i] = { unit: 0, team: 0 };
    //     }

    //     // Populate Zone 7 (center)
    //     const zone7UnitPool = [ENEMY_TEAM, ENEMY_TEAM, ENEMY_TEAM, PLAYER_TEAM, PLAYER_TEAM, 0, 0];
    //     shuffle(zone7UnitPool, true);
    //     for (let i = 0; i < ZONE_7_HEX_INDICES.length; i++) {
    //         const hexIndex = ZONE_7_HEX_INDICES[i];
    //         const team = zone7UnitPool[i];
    //         newBoard[hexIndex] = { unit: (team === 0) ? 0 : 1, team: team };
    //     }
    //     // Populate Outer Zones, passing `null` for the excluded zone since we're creating a full new board.
    //     populateNewOuterZones(newBoard, null, gameState.level);
    //     // 3. Apply the new board state to the game.
    //     for (let i = 0; i < hexagon.length; i++) {
    //         hexagon[i].unit = newBoard[i].unit;
    //         hexagon[i].team = newBoard[i].team;
    //     }
    //     if (sounds.boom2) sounds.boom2.play();
    //     return true;
    // }

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

    const canZoomIn = gameState.isPlayerTurn && gameState.level > 1 && gameState.zonesMovedFromThisTurn.size === 0; // prettier-ignore
    if (zoomInButton && zoomInButton.pressed() && canZoomIn) {
        // The button now simply toggles the selection mode on and off.
        // The actual zoom logic is handled when a zone is clicked.
        gameState.zoneSelectionMode = !gameState.zoneSelectionMode;
        gameState.selected = -1; // Deselect any unit
        gameState.badClick = 0;
        if (sounds.select) sounds.select.play();

        // If we are turning the mode OFF, clear the selected zone.
        if (!gameState.zoneSelectionMode) {
            gameState.selectedZone = null;
        }

        return true; // Action was handled
    }
    return false;
}

function handleMainMenuButton() {
    if (mainMenuButton && mainMenuButton.pressed()) {
        // Switch to the options screen.
        gameState.currentScreen = 'options';
        if (sounds.select) sounds.select.play();
        return true;
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
            gameState.cannonsThatTargetedThisTurn.clear();
            gameState.badClick = 0;
            gameState.playerTurnCount++;
            gameState.isPlayerTurn = false; // Switch to AI's turn
            saveGameState();
        }
        return true; // Fire button was pressed
    }
    return false;
}

/**
 * Handles clicks on the Options screen.
 */
function handleOptionsScreenClick() {
    if (optionsBackButton && optionsBackButton.pressed()) {
        gameState.currentScreen = 'game';
        if (sounds.select) sounds.select.play();
        return true;
    }

    // Handle clicks for the new OptionControl instances
    if (movementAnimationControl && movementAnimationControl.handleClicks()) return true;
    if (zoomAnimationControl && zoomAnimationControl.handleClicks()) return true;
    if (volumeControl && volumeControl.handleClicks()) return true;

    if (optionsNewGameButton && optionsNewGameButton.pressed()) {
        // This is the action that used to be on the main menu button.
        // It returns to the intro screen and clears the saved game.
        gameState = createDefaultGameState(); // Fully reset the game state
        localStorage.removeItem('zoomBftmSaveState');
        console.log("New game started. Previous save state cleared.");
        // The default state's currentScreen is 'intro', so no need to set it here.
        return true;
    }
    return false;
}

function mouseClicked() {
    // On the first click, initialize the audio context and set the master volume.
    if (!audioInitialized) {
        userStartAudio();
        updateMasterVolume(); // Apply the initial volume setting.
        audioInitialized = true;
    }

    // If the game is won, only check for the win screen button click and then stop.
    if (gameState.gameWon) {
        handleWinScreenClick();
        return;
    }

    // Block input during level transitions.
    if (zoomInAnimationState.phase !== 'inactive' || zoomOutAnimationState.phase !== 'inactive') {
        return;
    }

    // Handle clicks on pre-game screens (intro, instructions)
    if (gameState.currentScreen === 'intro' || gameState.currentScreen === 'instructions') {
        handleMenuScreenClick();
        return;
    }

    // Handle clicks on the new Options screen
    if (gameState.currentScreen === 'options') {
        handleOptionsScreenClick();
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

    // Handle main menu button
    if (handleMainMenuButton()) {
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

        // Selectively build the gameState to save, excluding transient UI/animation state.
        const gameStateToSave = {
            selected: -1, // Always reset selection on load
            zonesMovedFromThisTurn: Array.from(gameState.zonesMovedFromThisTurn),
            isPlayerTurn: gameState.isPlayerTurn,
            aiZonesMovedFromThisTurn: Array.from(gameState.aiZonesMovedFromThisTurn),
            aiMovesMadeThisTurn: gameState.aiMovesMadeThisTurn,
            introScreenDifficulty: gameState.introScreenDifficulty,
            validMoves: [], // Always reset on load
            currentScreen: gameState.currentScreen,
            levelMemory: Array.from(gameState.levelMemory.entries()),
            level: gameState.level,
            gameWon: gameState.gameWon,
            winRotation: gameState.winRotation,
            hasBeenOnLevel5: gameState.hasBeenOnLevel5,
            hasBeenOnLevel3: gameState.hasBeenOnLevel3,
            hasBeenOnLevel2: gameState.hasBeenOnLevel2,
            playerTurnCount: gameState.playerTurnCount,
            scoutMessageShownOnLevels: Array.from(gameState.scoutMessageShownOnLevels),
            cannonsThatTargetedThisTurn: Array.from(gameState.cannonsThatTargetedThisTurn),
            cannonThreats: Array.from(gameState.cannonThreats.entries()),
            movementAnimationSpeedSetting: gameState.movementAnimationSpeedSetting,
            zoomAnimationSpeedSetting: gameState.zoomAnimationSpeedSetting,
            masterVolume: gameState.masterVolume,
        };

        const stateToSave = {
            gameState: gameStateToSave,
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

        // Restore game state.
        // Start with a fresh default state and overwrite it with the saved data.
        // This ensures any properties not in the save file are correctly initialized to their defaults (e.g., null instead of undefined).
        gameState = {
            ...createDefaultGameState(),
            ...savedState.gameState,
            // Convert Arrays back to Sets
            zonesMovedFromThisTurn: new Set(savedState.gameState.zonesMovedFromThisTurn), // prettier-ignore
            aiZonesMovedFromThisTurn: new Set(savedState.gameState.aiZonesMovedFromThisTurn),            
            validMoves: new Set(savedState.gameState.validMoves), // prettier-ignore
            // Gracefully handle old save files that don't have the scout message history
            scoutMessageShownOnLevels: new Set(savedState.gameState.scoutMessageShownOnLevels || []), // prettier-ignore
            cannonsThatTargetedThisTurn: new Set(savedState.gameState.cannonsThatTargetedThisTurn || []),
            cannonThreats: new Map(savedState.gameState.cannonThreats || []),
            // Restore the levelMemory Map from its serialized array format.
            levelMemory: new Map(savedState.gameState.levelMemory || []),
        };

        // Backwards compatibility for old saves with a single animation setting
        if (savedState.gameState.animationSpeedSetting !== undefined) {
            gameState.movementAnimationSpeedSetting = savedState.gameState.animationSpeedSetting;
            gameState.zoomAnimationSpeedSetting = savedState.gameState.animationSpeedSetting;
        }

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