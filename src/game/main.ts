import { AUTO, Game, Scale, Types } from 'phaser';
import { SetupScene } from './scenes/SetupScene';
import { GameScene } from './scenes/GameScene';
import { applySavedSettings } from './settings';

// Single-scene game that fills the browser window (landscape on the phone). The
// camera shows a slice of a much larger world; see config.ts for the world size.
const config: Types.Core.GameConfig = {
    type: AUTO,
    parent: 'game-container',
    backgroundColor: '#0e141b',
    scale: {
        mode: Scale.RESIZE,
        autoCenter: Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
    },
    // Pixel-art friendly: no smoothing when we zoom into sprites later.
    pixelArt: true,
    // The pre-game Setup screen runs first; it launches the battle on "Start".
    scene: [SetupScene, GameScene],
};

const StartGame = (parent: string) => {
    // Re-apply the director's saved tunables over CONFIG before the scene reads it.
    applySavedSettings();
    return new Game({ ...config, parent });
};

export default StartGame;
