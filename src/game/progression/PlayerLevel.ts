import * as Phaser from 'phaser';
import { CONFIG } from '../config';

// Per-match player progression: experience earned by killing enemy units, spent advancing
// up a rising "grading scale" of levels. State only — the HUD reads from it and GameScene
// feeds it kills. A fresh instance is created each match (GameScene.create), so leveling
// resets every battle, mirroring ResourceStore's per-match lifecycle.
//
// The curve is config-driven (CONFIG.experience, live-tunable): the XP required to leave
// level n is baseXp + n × perLevel — a shallow linear ramp, so early levels come quickly
// and each one costs a little more than the last.
export class PlayerLevel {
    private _level = 1;
    private _xpIntoLevel = 0; // XP banked toward the NEXT level (always < xpForLevel(level))

    get level(): number {
        return this._level;
    }

    // XP accumulated toward the next level (the bar's numerator).
    get xpIntoLevel(): number {
        return this._xpIntoLevel;
    }

    // XP required to advance OUT of the given level (the bar's denominator). Reads CONFIG
    // each call so the Dev panel's live edits take effect immediately.
    xpForLevel(level: number): number {
        const { baseXp, perLevel } = CONFIG.experience;
        return Math.round(baseXp + level * perLevel);
    }

    // Fraction of the current level filled (0–1), for the HUD bar.
    get fraction(): number {
        return Phaser.Math.Clamp(this._xpIntoLevel / this.xpForLevel(this._level), 0, 1);
    }

    // Award XP and roll over as many levels as it covers. Returns the number of levels
    // gained (0 if none) — the single hook GameScene uses to fire the "LEVEL UP!" cue and
    // where future level-up rewards will attach.
    gain(amount: number): number {
        if (amount <= 0) return 0;
        this._xpIntoLevel += amount;
        let gained = 0;
        let need = this.xpForLevel(this._level);
        while (this._xpIntoLevel >= need) {
            this._xpIntoLevel -= need;
            this._level++;
            gained++;
            need = this.xpForLevel(this._level);
        }
        return gained;
    }
}
