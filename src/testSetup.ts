import { installReferenceLineCalibration } from './simulation/ReferenceLineCalibration';

// Production installs the miniature-circuit reference calibration before
// qualifying or race AI can build/cache a lap. Every Vitest worker must do the
// same so pack, circuit and regression tests exercise the line the player will
// actually race against rather than the raw optimizer dump.
installReferenceLineCalibration();
