/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License*/
"use strict";

// Show the compiler output if false
const deployed = true;

// Set to true to allow editing of quad://example/ files when developing quadplay
const ALLOW_EDITING_EXAMPLES = false;

const version  = '2020.04.11.19'
const launcherURL = 'quad://console/launcher';

//////////////////////////////////////////////////////////////////////////////////
// UI setup

{
    const c = document.getElementsByClassName(isMobile ? 'noMobile' : 'mobileOnly');
    for (let i = 0; i < c.length; ++i) {
        c[i].style.display = 'none';
    }
}

function getQueryString(field) {
    const reg = new RegExp('[?&]' + field + '=([^&#]*)', 'i');
    const string = reg.exec(location.search);
    return string ? string[1] : null;
}

const fastReload = getQueryString('fastReload') === '1';

const useIDE = getQueryString('IDE') || false;
{
    const c = document.getElementsByClassName(useIDE ? 'noIDE' : 'IDEOnly');
    for (let i = 0; i < c.length; ++i) {
        c[i].style.display = 'none';
    }
}

// Set on game load
let editableProject = false;

// Hide quadplay framerate debugging info
if (! profiler.debuggingProfiler) {  document.getElementById('debugIntervalTimeRow').style.display = 'none'; }

////////////////////////////////////////////////////////////////////////////////

// 'WideIDE', 'IDE', 'Test', 'Emulator', 'Editor', 'Maximal'. See also setUIMode().
let uiMode = 'IDE';

const BOOT_ANIMATION = Object.freeze({
    NONE:      0,
    SHORT:    32,
    REGULAR: 220
});

let SCREEN_WIDTH = 384, SCREEN_HEIGHT = 224;
let gameSource;

// The image being written during preview recording
let previewRecording = null;
let previewRecordingFrame = 0;

function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }
function makeEuroSmoothValue(minCutoff, speedCoefficient) {  return new EuroFilter(minCutoff, speedCoefficient); }

/* True if a URL is to a path that is a built-in dir for the current server */
function isBuiltIn(url) {
    if (url.startsWith('quad://')) { return true; }
    const quadPath = location.href.replace(/\/console\/quadplay\.html.*$/, '/');
    return (! ALLOW_EDITING_EXAMPLES && url.startsWith('/examples/')) ||
        url.startsWith('/games/') ||
        url.startsWith(quadPath + 'sprites/') ||
        url.startsWith(quadPath + 'fonts/') ||
        url.startsWith(quadPath + 'sounds/') ||
        url.startsWith(quadPath + 'scripts/') ||
        url.startsWith(quadPath + 'games/') ||
        (! ALLOW_EDITING_EXAMPLES && url.startsWith(quadPath + 'examples/')) ||
        url.startsWith(quadPath + 'console/') ||
        url.startsWith(quadPath + 'doc/');
}

function debugOptionClick(event) {
    const element = event.target;
    event.stopPropagation();
    if (element.id === 'wordWrapEnabled') {
        const outputDisplayPane = document.getElementById('outputDisplayPane');
        outputDisplayPane.style.whiteSpace = element.checked ? 'pre-wrap' : 'pre';
    } else {
        QRuntime['_' + element.id] = element.checked;
    }
    saveIDEState();
}

let codeEditorFontSize = 14;
function setCodeEditorFontSize(f) {
    codeEditorFontSize = Math.max(6, Math.min(32, f));
    localStorage.setItem('codeEditorFontSize', '' + codeEditorFontSize)
    //document.getElementById('ace').style.fontSize = codeEditorFontSize + 'px';
    aceEditor.setOption('fontSize',  codeEditorFontSize + 'px');
}


let colorScheme = 'pink';
function setColorScheme(scheme) {
    colorScheme = scheme;
    document.getElementById(scheme + 'ColorScheme').checked = 1;
    // Find the nano style sheet
    let stylesheet;
    for (let s of document.styleSheets) {
        if (s.href && s.href.indexOf('quadplay.css') !== -1) {
            stylesheet = s;
            break;
        }
    }
    if (! stylesheet) { return; }

    // Default to pink scheme
    let hrefColor = '#e61b9d';
    let emulatorColor = '#ff4488';

    switch (scheme) {
    case 'black':
        hrefColor = '#0af';
        emulatorColor = '#090909';
        break;
        
    case 'white':
        hrefColor = '#0af';
        emulatorColor = '#D2C4D2';
        break;

    case 'orange':
        hrefColor = '#ff7030';
        emulatorColor = '#f04C12';
        break;
        
    case 'gold':
        hrefColor = '#dca112';
        emulatorColor = '#b68216';
        break;
        
    case 'green':
        hrefColor = '#47b52e';
        emulatorColor = '#139613';
        break;
        
    case 'blue':
        hrefColor = '#0af';
        emulatorColor = '#1074b6';
        break;
    }
    
    // Find the relevant rules and remove them
    for (let i = 0; i < stylesheet.cssRules.length; ++i) {
        const rule = stylesheet.cssRules[i];
        if ((rule.selectorText === '#header a, .menu a') ||
            (rule.selectorText === '.emulator .emulatorBackground' && rule.style.background !== '')) {
            stylesheet.deleteRule(i);
            --i;
        }
    }
    // Replacement rules
    stylesheet.insertRule(`#header a, .menu a { color: ${hrefColor} !important; text-decoration: none; }`, 0);
    stylesheet.insertRule(`.emulator .emulatorBackground { background: ${emulatorColor}; ! important}`, 0);
    localStorage.setItem('colorScheme', colorScheme);
}

// Used for the event handlers to efficiently
// know whether to trigger onWelcomeTouch()
let onWelcomeScreen = ! useIDE;

/* 
   Force users in auto-play modes to interact in order to enable the audio engine and
   full-screen on mobile (where it is harder to hit the small full-screen button).
 */
function onWelcomeTouch() {
    onWelcomeScreen = false;
    const welcome = document.getElementById('welcome');
    welcome.style.zIndex = -100;
    welcome.style.visibility = 'hidden';
    welcome.style.display = 'none';

    unlockAudio();
    
    if (! useIDE || isMobile) {
        requestFullScreen();
    }

    let url = getQueryString('game')

    const showPause = url;
    
    url = url || launcherURL;
    // If the url doesn't have a prefix and doesn't begin with a slash,
    // assume that it is relative to the quadplay script in the parent dir.
    if (! (/^(.{3,}:\/\/|[\\/])/).test(url)) {
        url = '../' + url;
    }
    loadGameIntoIDE(url, function () {
        if (showPause) {
            // Show the pause message before loading when running a
            // standalone game (not in IDE, not loading the launcher)
            const pauseMessage = document.getElementById('pauseMessage');
            pauseMessage.style.zIndex = 120;
            pauseMessage.style.visibility = 'visible';
            pauseMessage.style.opacity = 1;
            setTimeout(function () {
                pauseMessage.style.opacity = 0;
                setTimeout(function() {
                    pauseMessage.style.visibility = 'hidden';
                    pauseMessage.style.zIndex = 0;
                    onPlayButton();
                }, 800);
            }, 3000);
        } else {
            // Loading launcher
            onPlayButton();
        }
    });
}


function unlockAudio() {
    // Play a silent sound in order to unlock audio on platforms
    // that require audio to first initiate on a click.
    //
    // https://paulbakaus.com/tutorials/html5/web-audio-on-ios/
    
    // create empty buffer
    var buffer = _ch_audioContext.createBuffer(1, 1, 22050);
    var source = _ch_audioContext.createBufferSource();
    source.buffer = buffer;
    
    // connect to output (your speakers)
    source.connect(_ch_audioContext.destination);
    
    // play the file
    if (source.noteOn) {
        source.noteOn(0);
    } else {
        source.start(0);
    }
}


function requestFullScreen() {
    // Full-screen the UI. This can fail if not triggered by a user interaction.
    try { 
        const body = document.getElementsByTagName('body')[0];
        if (body.requestFullscreen) {
            body.requestFullscreen();
        } else if (body.webkitRequestFullscreen) {
            body.webkitRequestFullscreen();
        } else if (body.mozRequestFullScreen) {
            body.mozRequestFullScreen();
        } else if (body.msRequestFullscreen) {
            body.msRequestFullscreen();
        }
    } catch (e) {}
}

let backgroundPauseEnabled = true;

function onBackgroundPauseClick(event) {
    event.stopPropagation();
    backgroundPauseEnabled = document.getElementById('backgroundPauseCheckbox').checked;
    saveIDEState();
}


function setUIMode(d, noAutoPlay) {
    if (! useIDE && (d === 'IDE' || d === 'WideIDE' || d === 'Editor' || d === 'Test')) {
        // When in dedicated play, no-IDE mode and the UI was
        // previously set to UI, fall back to the emulator.
        d = 'Emulator';
    }
    uiMode = d;
    const body = document.getElementsByTagName('body')[0];

    // Set the CSS class
    body.classList.remove('MaximalUI');
    body.classList.remove('EmulatorUI');
    body.classList.remove('IDEUI');
    body.classList.remove('WideIDEUI');
    body.classList.remove('EditorUI');
    body.classList.remove('TestUI');
    body.classList.add(uiMode + 'UI');

    // Check the appropriate radio button
    document.getElementById({'IDE'      : 'IDEUIButton',
                             'WideIDE'  : 'wideIDEUIButton',
                             'Emulator' : 'emulatorUIButton',
                             'Test'     : 'testUIButton',
                             'Maximal'  : 'maximalUIButton',
                             'Editor'   : 'editorUIButton'}[uiMode]).checked = 1;

    if ((uiMode === 'Maximal') || ((uiMode === 'Emulator') && ! useIDE)) {
        requestFullScreen();
    }

    // Need to wait for layout to update before the onResize handler
    // has correct layout sizes.
    setTimeout(onResize, 100);

    // Reset keyboard focus
    emulatorKeyboardInput.focus();
}


function onResize() {
    const body         = document.getElementsByTagName('body')[0];
    const background   = document.getElementsByClassName('emulatorBackground')[0];
    const screenBorder = document.getElementById('screenBorder');

    const gbMode = window.matchMedia('(orientation: portrait)').matches;

    let windowWidth = window.innerWidth, windowHeight = window.innerHeight;

    let scale = 1;
    
    switch (uiMode) {
    case 'Editor':
        document.getElementById('debugger').removeAttribute('style');
        background.removeAttribute('style');
        break;
        
    case 'WideIDE':
        scale = 2;
        // Fall through to IDE case
        
    case 'IDE':
        // Revert to defaults. This has to be done during resize
        // instead of setUIMode() to have any effect.
        emulatorScreen.removeAttribute('style');
        screenBorder.removeAttribute('style');
        document.getElementById('debugger').removeAttribute('style');
        if (SCREEN_WIDTH <= 384/2 && SCREEN_HEIGHT <= 224/2) {
            // Half-resolution games run with pixel doubling
            scale *= 2;
        }
        if (scale !== 1) {
            screenBorder.style.transform = 'scale(' + scale + ') translate3d(0,0,0)';
            screenBorder.style.transformOrigin = 'left top';
        }
        background.removeAttribute('style');
        break;
        
    case 'Emulator':
        {
            // What is the largest multiple SCREEN_HEIGHT that is less than windowHeightDevicePixels?
            if (gbMode) {
                scale = Math.max(0, Math.min((window.innerHeight - 70) / SCREEN_HEIGHT, (windowWidth - 36) / SCREEN_WIDTH));
            } else {
                scale = Math.max(0, Math.min((window.innerHeight - 70) / SCREEN_HEIGHT, (windowWidth - 254) / SCREEN_WIDTH));
            }
            
            if ((scale * window.devicePixelRatio <= 2.5) && (scale * window.devicePixelRatio > 1)) {
                // Round to nearest even multiple of the actual pixel size for small screens to
                // keep per-pixel accuracy
                scale = Math.floor(scale * window.devicePixelRatio) / window.devicePixelRatio;
            }
            
            let delta = (windowHeight - Math.max(260, 90 + SCREEN_HEIGHT * scale)) / 2;
            if (! gbMode) {
                // Resize the background to bound the screen more tightly.
                // Only resize vertically because the controls need to
                // stay near the edges of the screen horizontally to make
                // them reachable on mobile. In gbMode, the emulator fills
                // the screen and this is not needed.
                background.style.top = Math.round(Math.max(0, delta)) + 'px';
                background.style.height = Math.round(Math.max(230, SCREEN_HEIGHT * scale + 53)) + 'px';
            }
            
            // Setting the scale transform triggers really slow rendering on Raspberry Pi unless we
            // add the "translate3d" hack to trigger hardware acceleration.
            screenBorder.style.transform = 'scale(' + scale + ') translate3d(0,0,0)';
            screenBorder.style.left = Math.round((windowWidth - screenBorder.offsetWidth - 1) / 2) + 'px';
            if (gbMode) {
                screenBorder.style.transformOrigin = 'center top';
                screenBorder.style.top  = '30px';
            } else {
                screenBorder.style.transformOrigin = 'center';
                screenBorder.style.top  = Math.round(Math.max(0, -delta) + (windowHeight - screenBorder.offsetHeight - 34) / 2) + 'px';
            }


            // Show the controls
            body.classList.add('fullscreenEmulator');
            break;
        }

    case 'Maximal':
    case 'Test':
        {
            // What is the largest multiple SCREEN_HEIGHT that is less than windowHeightDevicePixels?
            scale = Math.max(0, Math.min((windowHeight - 24) / SCREEN_HEIGHT, (windowWidth - 2) / SCREEN_WIDTH));
            
            if ((scale * window.devicePixelRatio <= 2.5) && (scale * window.devicePixelRatio > 1)) {
                // Round to nearest even multiple of the actual pixel size for small screens to
                // keep per-pixel accuracy
                scale = Math.floor(scale * window.devicePixelRatio) / window.devicePixelRatio;
            }
            
            // Setting the scale transform triggers really slow rendering on Raspberry Pi unless we
            // add the "translate3d" hack to trigger hardware acceleration.
            screenBorder.style.transform = 'scale(' + scale + ') translate3d(0,0,0)';
            screenBorder.style.left = Math.round((windowWidth - screenBorder.offsetWidth - 4) / 2) + 'px';
            screenBorder.style.transformOrigin = 'center top';
            if (uiMode === 'Test') {
                screenBorder.style.top = '0px';
                document.getElementById('debugger').style.top = Math.round(scale * screenBorder.offsetHeight + 25) + 'px';
            } else {
                const t = Math.round((windowHeight - screenBorder.offsetHeight * scale - 26) / 2) + 'px';
                screenBorder.style.top  = t;
            }
        }
        break;
    }

    screenBorder.style.width = SCREEN_WIDTH + 'px';
    screenBorder.style.height = SCREEN_HEIGHT + 'px';
    screenBorder.style.borderRadius = Math.ceil(6 / scale) + 'px';
    screenBorder.style.borderWidth  = Math.ceil(5 / scale) + 'px';
    screenBorder.style.boxShadow = `${1/scale}px ${2/scale}px ${2/scale}px 0px rgba(255,255,255,0.16), ${-1.5/scale}px {-2/scale}px ${2/scale}px 0px rgba(0,0,0,0.19)`;

    if (isSafari) {
        // Safari cannot perform proper CSS image scaling, so we have
        // to resize the underlying canvas and copy to it with nearest
        // neighbor interpolation.
        emulatorScreen.width = Math.round(SCREEN_WIDTH * scale);
        emulatorScreen.height = Math.round(SCREEN_HEIGHT * scale);
        emulatorScreen.style.transformOrigin = 'top left';
        emulatorScreen.style.transform = 'scale(' + (1 / scale) + ') translate3d(0,0,0)';
    }
}

window.addEventListener("resize", onResize, false);

function onMenuButton(event) {
    closeDropdowns();
    const button = document.getElementById(event.target.id);
    const menu = document.getElementById(event.target.id.replace(/Button$/, ''));

    if (menu.style.visibility === 'visible') {
        menu.style.visibility = 'hidden';
    } else {
        menu.style.visibility = 'visible';
        menu.style.left = button.getBoundingClientRect().left + 'px';
    }

    event.stopPropagation();
}

const bootScreen = document.getElementById('bootScreen');
let emulatorScreen = document.getElementById('screen');

// Disable context menu popup on touch events for the game screen or virtual
// controller buttons because they should be processed solely by the emulator
emulatorScreen.oncontextmenu = function (event) { event.preventDefault(); event.stopPropagation(); };
{
    const classes = ['emulator', 'emulatorBackground', 'emulatorButton', 'virtualController', 'screenBorder'];
    for (let c = 0; c < classes.length; ++c) {
        const a = document.getElementsByClassName(classes[c]);
        for (let i = 0; i < a.length; ++i) {
            a[i].oncontextmenu = emulatorScreen.oncontextmenu;
        }
    }
}

// Do not set desynchronized:true. Doing so makes Chrome run about 12% slower as of version 75.
let ctx = emulatorScreen.getContext("2d",
                                    {
                                        alpha: false,
                                        desynchronized: false
                                    });

function onHelp(event) { window.open('doc/specification.md.html', '_blank'); }

function download(url, name) {
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
        window.URL.revokeObjectURL(url);  
        document.body.removeChild(a);
    }, 0);
}


function onOpenButton() {
    const url = window.prompt("Game URL", "");
    if (url) {
        onStopButton();
        loadGameIntoIDE(url, function () {
            onPlayButton();
        });
    }
}

function onHomeButton() {
    onStopButton();
    loadGameIntoIDE(launcherURL, function () {
        onResize();
        // Preven the boot animation
        onPlayButton(false, true);
    });
}

/** True if the game is running on the same server as the quadplay console */
function locallyHosted() {
    return gameURL.startsWith(location.origin) || ! /^([A-Za-z]){3,6}:\/\//.test(gameURL);
}

    
function onRestartButton() {
    onStopButton();
    onPlayButton();
}


let lastAnimationRequest = 0;
function onStopButton(inReset) {
    if (! inReset) {
        document.getElementById('stopButton').checked = 1;
        setControlEnable('pause', false);
        emulatorMode = 'stop';
        saveIDEState();
    }

    stopAllSounds();
    coroutine = null;
    clearTimeout(lastAnimationRequest);
    ctx.clearRect(0, 0, emulatorScreen.width, emulatorScreen.height);
}

function onSlowButton() {
    onPlayButton(true);
}

// Allows a framerate to be specified so that the slow button can re-use the logic.
//
// isLaunchGame = "has this been triggered by QRuntime.launch_game()"
// args = array of arguments to pass to the new program
function onPlayButton(slow, isLaunchGame, args) {
    if (isSafari && ! isMobile) { unlockAudio(); }

    if (uiMode === 'Editor') {
        // There is nothing useful to see in Editor mode
        // when playing, so bring the emulator up in IDE
        // mode.
        setUIMode('IDE', false);
    }
    
    targetFramerate = slow ? SLOW_FRAMERATE : PLAY_FRAMERATE;
    
    function doPlay() {
        if (slow) {
            document.getElementById('slowButton').checked = 1;
        } else {
            document.getElementById('playButton').checked = 1;
        }
        document.getElementById('playButton').checked = 1;
        setControlEnable('pause', true);
        _ch_audioContext.resume();
    
        setErrorStatus('');
        emulatorMode = 'play';
        profiler.reset();

        previewRecordingFrame = 0;
        previewRecording = null;
        
        if (! coroutine) {
            outputDisplayPane.innerHTML = '';
            compiledProgram = '';
            try {
                compiledProgram = compile(gameSource, fileContents, false);
                setErrorStatus('');
            } catch (e) {
                e.message = e.message.replace(/^line \d+: /i, '');
                if (e.message === 'Unexpected token :') {
                    e.message += ', possible due to a missing { on a previous line';
                }
                
                setErrorStatus('Error: ' + e.url + ', line ' + e.lineNumber + ': ' + e.message);
                if (isSafari) {
                    console.log('_currentLineNumber = ' + QRuntime._currentLineNumber);
                }
                console.log(e);
            }
            
            if (compiledProgram) {
                if (! deployed && useIDE) { console.log(compiledProgram); }
                
                // Ready to execute. Reload the runtime and compile and launch
                // this code within it.
                programNumLines = compiledProgram.split('\n').length;

                restartProgram(isLaunchGame ? BOOT_ANIMATION.NONE : useIDE ? BOOT_ANIMATION.SHORT : BOOT_ANIMATION.REGULAR);
            } else {
                programNumLines = 0;
                onStopButton();
            }
            
        } else {
            lastAnimationRequest = requestAnimationFrame(mainLoopStep);
            emulatorKeyboardInput.focus();
        }
        
        saveIDEState();
    }

    if (emulatorMode === 'play') {
        // Already in play mode, just refocus input
        emulatorKeyboardInput.focus();
        return;
    } else if (emulatorMode === 'stop') {
        // Reload the program
        if (loadManager.status !== 'complete' && loadManager.status !== 'failure') {
            console.log('Load already in progress...');
        } else {
            console.log('\n');
            if (useIDE && ! isLaunchGame) {
                if (savesPending === 0) {
                    // Force a reload of the game
                    loadGameIntoIDE(window.gameURL, doPlay);
                } else {
                    setErrorStatus('Cannot reload while saving. Try again in a second.');
                    onStopButton();
                }
            } else {
                // Just play the game, no reload required because
                // we are in user mode.
                doPlay();
            }
        }
    } else {
        console.assert(emulatorMode === 'step' || emulatorMode === 'pause');
        // Was just paused
        resumeAllSounds();
        doPlay();
        emulatorKeyboardInput.focus();
    }

}

const controlSchemeTable = {
    Quadplay: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓒ',
        '(d)': 'ⓓ',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
                          
    Zero: {
        '(a)': 'ⓑ',
        '(b)': 'ⓐ',
        '(c)': 'ⓨ',
        '(d)': 'ⓧ',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    PS3: {
        '(a)': 'ⓧ',
        '(b)': 'Ⓞ',
        '(c)': '▣',
        '(d)': '⍍',
        '(q)': 'ҕ',
        '(p)': 'ﯼ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    PS4: {
        '(a)': 'ⓧ',
        '(b)': 'Ⓞ',
        '(c)': '▣',
        '(d)': '⍍',
        '(p)': 'Ơ',
        '(q)': 'ડ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    XboxOne: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(p)': '☰',
        '(q)': '⧉',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    Xbox360: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(q)': '⊲',
        '(p)': '⊳',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    Stadia: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(q)': '…',
        '(p)': '☰',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    SNES: {
        '(a)': 'ⓑ',
        '(b)': 'ⓐ',
        '(c)': 'ⓨ',
        '(d)': 'ⓧ',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    SN30_Pro: {
        '(a)': 'ⓑ',
        '(b)': 'ⓐ',
        '(c)': 'ⓨ',
        '(d)': 'ⓧ',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
    
    SwitchPro: {
        '(a)': 'ⓑ',
        '(b)': 'ⓐ',
        '(c)': 'ⓨ',
        '(d)': 'ⓧ',
        '(q)': '⊖',
        '(p)': '⊕',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    JoyCon_R: {
        '(a)': 'ⓐ',
        '(b)': 'ⓧ',
        '(c)': 'ⓑ',
        '(d)': 'ⓨ',
        '(q)': '⒭',
        '(p)': '⊕',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    JoyCon_L: {
        '(a)': '▼',
        '(b)': '▶',
        '(c)': '◀',
        '(d)': '▲',
        '(q)': '⒧',
        '(p)': '⊖',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    // Use "return" on Apple platforms and "enter" on PCs
    Keyboard: {
        '(a)': '␣',
        '(b)': isApple ? '⏎' : 'Ɛ',
        '(c)': 'ⓒ',
        '(d)': 'ⓕ',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': 'Ⓦ',
        '[<]': 'Ⓐ',
        '[v]': 'Ⓢ',
        '[>]': 'Ⓓ'
    },

    Kbd_Alt: {
        '(a)': '␣',
        '(b)': isApple ? '⏎' : 'Ɛ',
        '(c)': 'ⓒ',
        '(d)': 'ⓕ',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    Kbd_P1: {
        '(a)': 'ⓥ',
        '(b)': 'ⓖ',
        '(c)': 'ⓒ',
        '(d)': 'ⓕ',
        '(p)': '④',
        '(q)': '①',
        '[^]': 'Ⓦ',
        '[<]': 'Ⓐ',
        '[v]': 'Ⓢ',
        '[>]': 'Ⓓ'
    },

    Kbd_P2: {
        '(a)': '⬙',
        '(b)': '⬗',
        '(c)': '⬖',
        '(d)': '⬘',
        '(p)': '⓪',
        '(q)': '⑦',
        '[^]': 'Ⓘ',
        '[<]': 'Ⓙ',
        '[v]': 'Ⓚ',
        '[>]': 'Ⓛ'
    },

    HOTAS: {
        '(a)': '①',
        '(b)': '②',
        '(c)': '④',
        '(d)': '③',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    GPD_Win: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    }
};

// Create aliases
for (const name in controlSchemeTable) {
    const scheme = controlSchemeTable[name];
    scheme['ⓐ'] = scheme['(a)'];
    scheme['ⓑ'] = scheme['(b)'];
    scheme['ⓒ'] = scheme['(c)'];
    scheme['ⓓ'] = scheme['(d)'];
    scheme['ⓟ'] = scheme['(p)'];
    scheme['ⓠ'] = scheme['(q)'];
    scheme['⍐'] = scheme['[^]'];
    scheme['⍗'] = scheme['[v]'];
    scheme['⍇'] = scheme['[<]'];
    scheme['⍈'] = scheme['[>]'];
    Object.freeze(scheme);
}


/** Called by reset_game() as well as the play and reload buttons to
    reset all game state and load the game.  */
function restartProgram(numBootAnimationFrames) {
    reloadRuntime(function () {
        try {
            // Inject the constants into the runtime space
            makeConstants(QRuntime, gameSource.constants, gameSource.CREDITS);
            makeAssets(QRuntime, gameSource.assets);
        } catch (e) {
            // Compile-time error
            onStopButton();
            setErrorStatus(e);
        }
        
        // Create the main loop function in the QRuntime environment so
        // that it sees those variables.
        try {
            coroutine = QRuntime._makeCoroutine(compiledProgram);
            QRuntime._numBootAnimationFrames = numBootAnimationFrames;
            lastAnimationRequest = requestAnimationFrame(mainLoopStep);
            emulatorKeyboardInput.focus();
        } catch (e) {
            // "Link"-time or run-time on a script error
            onStopButton();
            e = jsToNSError(e);
            setErrorStatus('file ' + e.url + ' line ' + clamp(1, e.lineNumber, programNumLines) + ': ' + e.message);
            return;
        }
    });
}


function showWaitDialog() {
    document.getElementById('waitDialog').classList.remove('hidden');
}


function hideWaitDialog() {
    document.getElementById('waitDialog').classList.add('hidden');
}


function closeDropdowns() {
    const list = document.getElementsByClassName('dropdown');
    for (let i = 0; i < list.length; ++i) {
        list[i].style.visibility = 'hidden';
    }
}

window.onclick = function(event) {
    /*
    // Hide modal dialogs
    if (event.target.classList.contains('modal') && (event.target !== document.getElementById('waitDialog'))) {
        event.target.classList.add('hidden');
    }
    */
    
    // Hide dropdown menus
    closeDropdowns();
} 



function onStepButton() {
    switch (emulatorMode) {
    case 'play':
        onPauseButton();
        break;

    case 'stop':
    case 'pause':
        onPlayButton();
        if (emulatorMode === 'play') {
            emulatorMode = 'step';
        }
        break;
    }
}


function onPauseButton() {
    if (emulatorMode === 'play' || emulatorMode === 'step') {
        document.getElementById('pauseButton').checked = 1;
        emulatorMode = 'pause';
        pauseAllSounds();
    }
}


function inModal() { return false; }

function onDocumentKeyDown(event) {
    if (onWelcomeScreen) {
        onWelcomeTouch();
        event.preventDefault();
        return;
    }
    
    switch (event.which || event.keyCode) {
    case 187: // ^= ("^+")
        if (! (event.ctrlKey || event.metaKey)) { break; }
        event.preventDefault();
        onIncreaseFontSizeButton();
        break;
        
    case 189: // ^-
        if (! (event.ctrlKey || event.metaKey)) { break; }
        event.preventDefault();
        onDecreaseFontSizeButton();
        break;
        
    case 121: // F10
        event.preventDefault();
        if (! inModal() && useIDE) {
            onStepButton();
        }
        break;

    case screenshotKey: // F6
        downloadScreenshot();
        break;

    case 71: // G
        if (! (event.ctrlKey || event.metaKey)) { break; }
        // Otherwise, Ctrl+G was pressed, so fall through
    case gifCaptureKey: // F8
        if (event.shiftKey) {
            if (! previewRecording) {
                startPreviewRecording();
            }
        } else {
            toggleGIFRecording();
        }
        break;        
        
    case 116: // F5
        event.preventDefault();
        if (! inModal() && useIDE) {
            if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
                onRestartButton();
            } else if (event.shiftKey) {
                onStopButton();
            } else {
                onPlayButton();
            }
        }
        break;

    case 80: // P
        if (event.ctrlKey || event.metaKey) { // Ctrl+P
            // Don't print!
            // Intercept from browser
            event.preventDefault();
        }
        break;
        
        
    case 82: // R
        if (event.ctrlKey || event.metaKey) { // Ctrl+R
            // Intercept from browser
            event.preventDefault();
            if (! inModal()) { onRestartButton(); }
        }
        break;

    case 67: // C
        if (! event.ctrlKey && ! event.metaKey) {
            return;
        }
        // Fall through
            
    case 19: // [Ctrl+] Break
        if (useIDE) { onPauseButton(); }
        break;
    }
}

document.addEventListener('keydown', onDocumentKeyDown);

const jsCode = document.getElementById('jsCode') && ace.edit(document.getElementById('jsCode'));
const editorStatusBar = document.getElementById('editorStatusBar');
const aceEditor = ace.edit('ace');

aceEditor.setTheme('ace/theme/quadplay');

// Stop auto-completion of parentheses
aceEditor.setBehavioursEnabled(false);
aceEditor.setOptions({showPrintMargin:false});

function saveIDEState() {
    const options = {
        'uiMode': uiMode,
        'backgroundPauseEnabled': backgroundPauseEnabled,
        'colorScheme': colorScheme,
        'showPhysicsEnabled': document.getElementById('showPhysicsEnabled').checked,
        'showEntityBoundsEnabled': document.getElementById('showEntityBoundsEnabled').checked,
        'assertEnabled': document.getElementById('assertEnabled').checked,
        'debugWatchEnabled': document.getElementById('debugWatchEnabled').checked,
        'debugPrintEnabled': document.getElementById('debugPrintEnabled').checked,
        'codeEditorFontSize': codeEditorFontSize
    };

    for (let name in options) {
        localStorage.setItem(name, options[name]);
    }
}


function showGamepads() {
    let s = 'Gamepads = [';
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads : []);
    for (let i = 0; i < gamepads.length; ++i) {
        let pad = gamepads[i];
        if (pad && pad.connected) {
            s += '"' + pad.id + '", ';
        }
    }

    s += ']';
    s = s.replace('", ]', '"]');
    alert(s);
}


let soundEditorCurrentSound = null;

/** Called when a project tree control element is clicked */
function onProjectSelect(target, type, object) {
    // Hide all editors
    const editorFrame = document.getElementById('editorFrame');
    for (let i = 0; i < editorFrame.children.length; ++i) {
        editorFrame.children[i].style.visibility = 'hidden';
    }
    
    const gameEditor     = document.getElementById('gameEditor');
    const modeEditor     = document.getElementById('modeEditor');
    const codePlusFrame = document.getElementById('codePlusFrame');

    // Hide the viewers within the content pane for the code editor
    const codeEditorContentFrame = document.getElementById('codeEditorContentFrame');
    for (let i = 0; i < codeEditorContentFrame.children.length; ++i) {
        codeEditorContentFrame.children[i].style.visibility = 'hidden';
    }

    const codeEditor     = document.getElementById('codeEditor');
    const spriteEditor   = document.getElementById('spriteEditor');
    const soundEditor    = document.getElementById('soundEditor');
    const mapEditor      = document.getElementById('mapEditor');
    const docEditor      = document.getElementById('docEditor');

    document.getElementById('spriteEditorHighlight').style.visibility =
        document.getElementById('spriteEditorPivot').style.visibility = 'hidden';
    
    let list = document.getElementsByClassName('selectedProjectElement');
    for (let i = 0; i < list.length; ++i) {
        list[i].classList.remove('selectedProjectElement');
    }

    if ((type === 'mode') && (object === undefined)) {
        // Select the mode diagram itself
        target.classList.add('selectedProjectElement');
        visualizeModes(modeEditor);
        modeEditor.style.visibility = 'visible';
        return;
    }

    if (type === 'doc') {
        // Documents
        target.classList.add('selectedProjectElement');
        showGameDoc(object.url);
        docEditor.style.visibility = 'visible';
        codePlusFrame.style.visibility = 'visible';

        codePlusFrame.style.gridTemplateRows = '0px 0px 100%';
        
        if (object.url.endsWith('.md') ||
            object.url.endsWith('.html') ||
            object.url.endsWith('.txt')) {

            // Show the editor after loading the content
            if (fileContents[object.url] !== undefined) {
                codePlusFrame.style.gridTemplateRows = '3fr 7px 4fr';
                setCodeEditorSession(object.url);
            } else {
                // Load and set the contents
                const loadManager = new LoadManager({forceReload: true});
                loadManager.fetch(object.url, 'text', null, function (doc) {
                    fileContents[object.url] = doc;
                    codePlusFrame.style.gridTemplateRows = '3fr 7px 4fr';
                    setCodeEditorSession(object.url);
                });
                loadManager.end();
            }
        }
        return;
    }

    if (type === 'game') {
        if (target) { target.classList.add('selectedProjectElement'); }
        visualizeGame(gameEditor, gameSource.jsonURL, gameSource.json);
        gameEditor.style.visibility = 'visible';
        return;
    }

    // Find the parent .li
    while (target && (target.tagName !== 'LI')) {
        target = target.parentNode;
    }

    if (target) {
        target.classList.add('selectedProjectElement');
    }

    switch (type) {
    case 'constant':
        showConstantEditor(object);
        break;
        
    case 'mode':
    case 'script':
        {
            // See if there is already an open editor session, and create one if it
            // doesn't exist
            const url = (type === 'mode') ? object.url : object;
            setCodeEditorSession(url);
            // Show the code editor, hide the content pane
            codePlusFrame.style.visibility = 'visible';
            codePlusFrame.style.gridTemplateRows = '1fr 0px 0px';
        }
        break;
        
    case 'asset':
        const url = object._url || object.src;
        setCodeEditorSession(object._jsonURL);

        // Show the code editor and the content pane
        codePlusFrame.style.visibility = 'visible';
        codePlusFrame.style.gridTemplateRows = '2fr 7px 5fr';
        const spriteEditorHighlight = document.getElementById('spriteEditorHighlight');
        const spriteEditorPivot = document.getElementById('spriteEditorPivot');
        const spriteEditorInfo = document.getElementById('spriteEditorInfo');
        spriteEditorHighlight.style.visibility = 'hidden';
        spriteEditorPivot.style.visibility = 'hidden';
        spriteEditor.onmousemove = spriteEditor.onmousedown = undefined;
        
        if (/\.png$/i.test(url)) {
            // Sprite or font
            spriteEditor.style.visibility = 'visible';
            spriteEditor.style.backgroundImage = `url("${url}")`;

            if (object._type === 'spritesheet') {
                const spritesheetName = object._name.replace(/.* /, '');
                spriteEditor.onmousemove = spriteEditor.onmousedown = function (e) {
                    const editorBounds = spriteEditor.getBoundingClientRect();

                    // The spritesheet is always fit along the horizontal axis
                    const scale = editorBounds.width / object.size.x;
                    
                    const mouseX = e.clientX - editorBounds.left;
                    const mouseY = e.clientY - editorBounds.top;
                    
                    const scaledSpriteWidth = object.sprite_size.x * scale;
                    const scaledSpriteHeight = object.sprite_size.y * scale;

                    spriteEditorPivot.style.fontSize = Math.round(clamp(Math.min(scaledSpriteWidth, scaledSpriteHeight) * 0.18, 5, 25)) + 'px';

                    const X = Math.floor(mouseX / scaledSpriteWidth);
                    const Y = Math.floor(mouseY / scaledSpriteHeight);

                    spriteEditorHighlight.style.left   = Math.floor(X * scaledSpriteWidth) + 'px';
                    spriteEditorHighlight.style.top    = Math.floor(Y * scaledSpriteHeight) + 'px';
                    spriteEditorHighlight.style.width  = Math.floor(scaledSpriteWidth) + 'px';
                    spriteEditorHighlight.style.height = Math.floor(scaledSpriteHeight) + 'px';
                    
                    const sprite = object[X] && object[X][Y];
                    if (sprite) {
                        const pivot = sprite.pivot || {x: 0, y: 0};
                        spriteEditorPivot.style.visibility = 'visible';
                        spriteEditorPivot.style.left = Math.floor(scale * (sprite.pivot.x + sprite.size.x / 2) - spriteEditorPivot.offsetWidth / 2) + 'px';
                        spriteEditorPivot.style.top = Math.floor(scale * (sprite.pivot.y + sprite.size.y / 2) - spriteEditorPivot.offsetHeight / 2) + 'px';
                            
                        let str = `${spritesheetName}[${X}][${Y}]`;
                        if (sprite._animationName) {
                            str += `<br>${spritesheetName}.${sprite._animationName}`
                            if (sprite._animationIndex !== undefined) {
                                const animation = object[sprite._animationName];
                                str += `[${sprite._animationIndex}]<br>extrapolate: "${animation.extrapolate || 'clamp'}"`;
                            }
                        }

                        str += `<br>duration: ${sprite.duration}`;
                        spriteEditorInfo.innerHTML = str;
                        
                        if (X > object.length / 2) {
                            spriteEditorInfo.style.float = 'right';
                            spriteEditorHighlight.style.textAlign = 'right';
                        } else {
                            spriteEditorInfo.style.float = 'none';
                            spriteEditorHighlight.style.textAlign = 'left';
                        }
                        spriteEditorInfo.style.marginTop = Math.floor(scaledSpriteHeight + 5) + 'px';
                        spriteEditorHighlight.style.visibility = 'inherit';
                    } else {
                        // Out of bounds
                        spriteEditorHighlight.style.visibility = 'hidden';
                        spriteEditorPivot.style.visibility = 'hidden';
                    }
                };
                
                // Initial position
                const editorBounds = spriteEditor.getBoundingClientRect();
                spriteEditor.onmousemove({clientX: editorBounds.left, clientY: editorBounds.top});
            } else {
                spriteEditorHighlight.style.visibility = 'hidden';
                spriteEditorPivot.style.visibility = 'hidden';
            }
        } else if (/\.mp3$/i.test(url)) {
            soundEditor.style.visibility = 'visible';
            soundEditorCurrentSound = fileContents[url];
        } else if (/\.tmx$/i.test(url)) {
            visualizeMap(object);
            mapEditor.style.visibility = 'visible';
        }
        break;
    }
}


// Callback for iframe reloading
function setIFrameScroll(iframe, x, y) {
    const html = iframe.contentWindow.document.getElementsByTagName('html')[0];
    html.scrollLeft = x;
    html.scrollTop = y;
}

/* Updates the preview pane of the doc editor. If useFileContents is true,
   use fileContents[url] when not undefined instead of actually reloading. */
function showGameDoc(url, useFileContents) {
    const docEditor = document.getElementById('docEditor');

    const preserveScroll = (docEditor.lastURL === url);
    docEditor.lastURL = url;

    const srcdoc = useFileContents ? fileContents[url] : undefined;

    // Store old scroll position
    let oldScrollX = 0, oldScrollY = 0;
    {
        const element = document.getElementById('doc');
        if (element) {
            if (element.contentWindow) {
                // Only works when the document is on the same domain
                const doc = element.contentWindow.document;
                const html = doc.getElementsByTagName('html')[0];
                oldScrollX = Math.max(html.scrollLeft, doc.body.scrollLeft);
                oldScrollY = Math.max(html.scrollTop, doc.body.scrollTop);
            } else {
                oldScrollX = element.scrollLeft;
                oldScrollY = element.scrollTop;
            }
        }
    }
    
    // Strip anything sketchy that looks like an HTML attack from the URL
    console.assert(url !== undefined);
    url = url.replace(/['" ><]/g, '');
    if (url.endsWith('.html')) {
        // Includes the .md.html case
        let s = `<iframe id="doc" width="125%" height="125%" onload="setIFrameScroll(this, ${oldScrollX}, ${oldScrollY})" `;
        
        if (srcdoc !== undefined) {
            const html = srcdoc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            s += 'srcdoc="' + html + '"';
        } else {
            s += `src="${url}?"`;
        }
        docEditor.innerHTML = s +'></iframe>';
    } else if (url.endsWith('.md')) {
        // Trick out .md files using Markdeep
        
        function markdeepify(text) {
            // Set base URL and add Markdeep processing
            const base = urlDir(url);
            const markdeepURL = makeURLAbsolute('', 'quad://doc/markdeep.min.js');
            
            // Escape quotes to avoid ending the srcdoc prematurely
            return `<base href='${base}'>\n${text.replace(/"/g, '&quot;')}
                <style>
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif}

.md a, .md div.title, contents, .md .tocHeader, 
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6, .md .nonumberh1, .md .nonumberh2, .md .nonumberh3, .md .nonumberh4, .md .nonumberh5, .md .nonumberh6, 
.md .shortTOC, .md .mediumTOC, .md .longTOC {
    color: inherit;
    font-family: inherit;
}
.md .title, .md h1, .md h2, .md h3, .md h4, .md h5, .md h6, .md .nonumberh1, .md .nonumberh2, .md .nonumberh3, .md .nonumberh4, .md .nonumberh5, .md .nonumberh6 {
margin-top: 0; padding-top: 0
}
.md h2 { border-bottom: 2px solid }
.md div.title { font-size: 40px }
.md .afterTitles { height: 0; padding-top: 0; padding-bottom: 0 }
</style>\n

<!-- Markdeep: --><script src='${markdeepURL}'></script>\n`;            
        }

        if (srcdoc !== undefined) {
            docEditor.innerHTML = `<iframe id="doc" onload="setIFrameScroll(this, ${oldScrollX}, ${oldScrollY})" srcdoc="${markdeepify(srcdoc)}" border=0 width=125% height=125%></iframe>`;
        } else {
            loadManager = new LoadManager({
                errorCallback: function () { console.log('Error while loading', url); },
                forceReload: true});
            loadManager.fetch(url, 'text', null,  function (text) {
                docEditor.innerHTML = `<iframe id="doc" srcdoc="${markdeepify(text)}" onload="setIFrameScroll(this, ${oldScrollX}, ${oldScrollY})" border=0 width=125% height=125%></iframe>`;
            }),
            loadManager.end();
        }
    } else {
        // Treat as text file
        docEditor.innerHTML = `<object id="doc" width="125%" height="125%" type="text/plain" data="${url}?" border="0"> </object>`;
    }

}


/** Called from visualizeModes(). Attempts to resolve intersections if
    these arrays of points cross each other. Treats them as polylines
    for simpler intersection determination even though we actually
    render using quadratic beziers. These could be subdivided if more
    accuracy was important, but since this function is only used for
    some layout heuristics, that is not currently justified. */
function resolveModeGraphEdgeIntersection(pointsA, dirA, pointsB, dirB) {
    // dirA/B are +/-1 for the iteration direction. If positive, then
    // the shared endpoint (at which to swap) is at index 0, otherwise
    // it is at index n
    // Compare all sublines
    let intersect = false;
    for (let i = 0; (i < pointsA.length - 1) && ! intersect; ++i) {
        for (let j = 0; (j < pointsB.length - 1) && ! intersect; ++j) {
            intersect = linesIntersect(pointsA[i], pointsA[i + 1], pointsB[j], pointsB[j + 1]);
        } // j
    } // i

    if (intersect) {
        // Indices of the points nearest the shared node
        const a = (dirA === 1) ? 0 : pointsA.length - 1;
        const b = (dirB === 1) ? 0 : pointsB.length - 1;

        // Swap two end points
        const temp = pointsA[a]; pointsA[a] = pointsB[b]; pointsB[b] = temp;

        // Remove any intermediate point that comes immediately before these
        // end points in a curve. This is an attempt to straighten the line
        // near the shared node while avoiding creating collisions with other nodes.
        if (pointsA.length > 2) { pointsA.splice(a + dirA, 1) }
        if (pointsB.length > 2) { pointsB.splice(b + dirB, 1) }
    }
}


/** Returns true if line segment AC intersects BD */
function linesIntersect(A, C, B, D) {
    // Simplified from https://github.com/pgkelley4/line-segments-intersect/blob/master/js/line-segments-intersect.js
    // by ignoring the parallel cases
    
    const dA = QRuntime._sub(C, A);
    const dB = QRuntime._sub(D, B);
    const diff = QRuntime._sub(B, A);

    const numerator = QRuntime.cross(diff, dA);
    const denominator = QRuntime.cross(dA, dB);

    if (Math.max(Math.abs(denominator), Math.abs(numerator)) < 1e-10) {
        // Parallel cases
        return false;
    }

    const u = numerator / denominator;
    const t = QRuntime.cross(diff, dB) / denominator;

    // Intersect within the segments
    return (t >= 0) && (t <= 1) && (u >= 0) && (u <= 1);
}


function visualizeModes(modeEditor) {
    // dagre API: https://github.com/dagrejs/graphlib/wiki/API-Reference#graph-api
    
    function nodeToHTMLColor(node) {
        if (node.label === 'Play') {
            // Force the Play node to white. It is almost always near
            // the center of the graph and nearly white anyway, but
            // this improves contrast.
            return '#fff';
        }
        
        const x = Math.min(1, Math.max(0, 1.5 * node.x / graph._label.width - 0.25));
        const y = Math.min(1, Math.max(0, 1.5 * node.y / graph._label.height - 0.25));

        // Use a Red-Cyan-Yellow color wheel
        let r = Math.max(Math.sqrt(1 - x), Math.max(2 * y - 0.8, 0));
        let g = Math.max(Math.sqrt((x*0.95+0.05) * y), 0.6 * Math.pow(Math.max(2 * (1 - y) - 1, 0), 2));
        let b = Math.sqrt((x*0.95+0.05) * Math.sqrt(1.1 - y));

        // Boost around the green primary
        g += 0.5 * x * Math.max(0, (1 - Math.abs(y - 0.6) * 2));
        
        // Maximize value
        const m = Math.max(r, g, b);
        r /= m; g /= m; b /= m;

        // Decrease saturation
        const s = 0.65;
        // Code to decrease saturation radially, no longer needed now that
        // we special-case the "Play" mode:
        //  s = Math.min(1, Math.pow(Math.hypot(x - 0.5, y - 0.5), 2) * 1.7);

        // Reduce saturation and convert to [0, 255]
        r = Math.round((r * s + (1 - s)) * 255);
        g = Math.round((g * s + (1 - s)) * 255);
        b = Math.round((b * s + (1 - s)) * 255);
        return `rgb(${r}, ${g}, ${b})`;
    }
    
    // Get nodes
    const nodeArray = [], nodeTable = {};
    let startNode = null;
    for (let m = 0; m < gameSource.modes.length; ++m) {
        const mode = gameSource.modes[m];
        const name = mode.name.replace(/^.*\/|\*/g, '');
        // Skip system modes
        if (name[0] === '_') { continue; }
        const isStart = (mode.name.indexOf('*') !== -1);
        const node = {name:name, label:name, edgeArray:[], isStart:isStart};
        if (isStart) { startNode = node; }
        nodeArray.push(node);
        nodeTable[name] = node;
    }

    if (! startNode) {
        setErrorStatus('No starting node specified.');
        return;
    }

    const setModeRegexp = /\b(set_mode|push_mode)\s*\(([^,_)]+)(?:.*)\)(?:\s*because\s*"([^"\n]*)")?/g;
    const reset_gameRegexp = /\breset_game\s*\(.*\)(?:\s*because\s*"([^"\n]*)")?/g;

    // Modes that have links back to their parent mode, whether
    // entered by set_mode or push_mode. These have to be processed
    // after all other links are discovered.
    let backLinks = [];
    
    // Get edges for each node
    for (let m = 0; m < gameSource.modes.length; ++m) {
        const mode = gameSource.modes[m];
        const name = mode.name.replace(/^.*\/|\*/g, '');
        // Skip system modes
        if (name[0] === '_') { continue; }
        const code = fileContents[mode.url];

        const edgeArray = nodeTable[name].edgeArray;
        for (let match = setModeRegexp.exec(code); match; match = setModeRegexp.exec(code)) {
            const to = nodeTable[match[2]];
            if (to) {
                edgeArray.push({to:to, label:match[3], type:match[1]});
            } else {
                setErrorStatus(mode.url + ': set_mode to nonexistent mode ' + match[2]);
                return;
            }
        } // for each set_mode statement

        for (let match = reset_gameRegexp.exec(code); match; match = reset_gameRegexp.exec(code)) {
            edgeArray.push({to:startNode, label:match[1], type:'reset_game'});
        } // for each set_mode statement
    } // for each mode

    //////////////////////////////////////////////////////////////////////////////////////
    // Convert to the layout API
    const graph = new dagre.graphlib.Graph({directed:true, multigraph:true});
    const nodeWidth = 112, nodeHeight = 28;
    graph.setGraph({rankdir: 'LR'});
    graph.setDefaultEdgeLabel(function() { return {}; });

    let edgeId = 0;
    for (let n = 0; n < nodeArray.length; ++n) {
        const node = nodeArray[n];
        // Make the play node a little larger than the others
        const s = node.label === 'Play' ? 1.3 : 1;
        graph.setNode(node.name,
                      {label:    node.label,
                       width:    s * nodeWidth,
                       height:   s * nodeHeight,
                       isStart:  node.isStart});

        for (let e = 0; e < node.edgeArray.length; ++e) {
            const edge = node.edgeArray[e];
            graph.setEdge(node.name, edge.to.name,
                          {label:     edge.label,
                           width:     edge.label ? edge.label.length * 3.5 : 0,
                           height:    8,
                           labelpos: 'c',
                           bidir:    (edge.type === 'push_mode')
                          }, 'edge' + edgeId);
            ++edgeId;
        }
    }
    
    // Compute layout on the mode graph
    dagre.layout(graph);

    // Render the mode graph to SVG
    let svg = `<svg class="modeGraph" width=${graph._label.width + 40} height=${graph._label.height + 60} viewbox="-20 -30 ${graph._label.width + 40} ${graph._label.height + 40}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`;
    svg += `<defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" y="-25%" height="150%" flood-opacity="0.5" filterUnits="userSpaceOnUse"/></filter>
<filter id="outerglow">
<feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-opacity="1.0" flood-color="#302b2b" filterUnits="userSpaceOnUse"/>
<feDropShadow dx="0" dy="0" stdDeviation="1" flood-opacity="1.0" flood-color="#302b2b" filterUnits="userSpaceOnUse"/>
</filter>
</defs>`

    // If there are two edges that share a node which cross each other
    // when rendered, see if swapping their rendering endpoints eliminates
    // the crossing. This tends to occur because incoming edges always
    // go to the bottom of nodes and outgoing edges always go to the top.

    graph.nodes().forEach(function(n) {
        const edges = graph.nodeEdges(n);
        edges.forEach(function(e1) {
            const edge1 = graph.edge(e1);
            edges.forEach(function(e2) {
                const edge2 = graph.edge(e2);
                // Only perform comparisons one way; use the Y axis to arbitrarily distingish order
                if ((e1 !== e2) && (edge1.points[0].y < edge2.points[0].y)) {
                    resolveModeGraphEdgeIntersection(edge1.points, (e1.v === n) ? 1 : -1, edge2.points, (e2.v === n) ? 1 : -1);
                }
            }); // edge2
        }); // edge1
    }); // nodes
    
    let i = 0;
    graph.edges().forEach(function(e) {
        const edge = graph.edge(e);

        // Inherit color from the start node
        edge.color = nodeToHTMLColor(graph.node(e.v));
        edge.endColor = nodeToHTMLColor(graph.node(e.w));
        const points = edge.points;
        
        // Define arrow head
        svg += `<defs>
    <marker id="arrowhead${i}" markerWidth="8" markerHeight="8" refX="7" refY="2" orient="auto" position="95%">
      <path d="M 0 0 L 0 4 L 6 2 z" fill="${edge.color}" />
    </marker>
  </defs>`;

        // Browsers have weird svg-filter issues (that affect shadow
        // rendering) with small objects in SVG, even if they have
        // correct bounding boxes.  Compute our own bounds bounds for the curve
        // to detect too-small boxes.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < points.length; ++i) {
            minX = Math.min(minX, points[i].x); minY = Math.min(minY, points[i].y);
            maxX = Math.max(maxX, points[i].x); maxY = Math.max(maxY, points[i].y);
        }
        const tooSmall = Math.min(maxX - minX, maxY - minY) < 8;
        
        // Define bidirectional arrow
        if (edge.bidir) {
            // Set the x1,y1 and x2,y2 based on the path direction
            const first = points[0], last = points[points.length - 1];
            const x1 = (last.x > first.x) ? minX : maxX;
            const y1 = (last.y > first.y) ? minY : maxY;
            const x2 = (last.x > first.x) ? maxX : minX;
            const y2 = (last.y > first.y) ? maxY : minY;

            // gradientUnits="userSpaceOnUse" is needed to support perfectly horizontal lines
            // with zero vertical extent
            svg += `<defs>
    <marker id="endarrowhead${i}" markerWidth="8" markerHeight="8" refX="0" refY="2" orient="auto" position="5%">
      <path d="M 0 2 L 6 0 L 6 4 z" fill="${edge.endColor}" />
    </marker>
    <linearGradient id="gradient${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${edge.endColor}"/>
      <stop offset="100%" stop-color="${edge.color}"/>
    </linearGradient>
  </defs>`;
        }

        svg += `<path class="edge" stroke="${edge.bidir ? 'url(#gradient' + i + ')' : edge.color}" marker-end="url(#arrowhead${i})" `;
        if (tooSmall) {
            svg += 'style="filter:none" ';
        }

        if (edge.bidir) {
            svg += `marker-start="url(#endarrowhead${i}" `;
        }

        svg += `d="M ${points[0].x} ${points[0].y} `;

        if (edge.points.length === 2) {
            // Line
            svg += `L ${points[1].x} ${points[1].y}`;
        } else if (edge.points.length === 3) {
            // Quadratic bezier
            svg += `Q ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y} `;           
        } else if (edge.points.length === 4) {
            // Never observed to be generated by dagre
            svg += `C ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y}, ${points[3].x} ${points[3].y} `;
        } else if (edge.points.length >= 5) {
            // Quadratic bezier with a line in the center. Yse a
            // polyline for that central linear part in case something
            // unexpected happened and there actually are intermediate
            // nodes off the line.
            const N = points.length;
            svg += `Q ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y} `;
            for (let i = 3; i < N - 2; ++i) {
                svg += `L ${points[i].x} ${points[i].y} `;
            }
            svg += `Q ${points[N - 2].x} ${points[N - 2].y}, ${points[N - 1].x} ${points[N - 1].y} `;
        }

        svg += '"/>';
        ++i;
    });

    // Labels on top of edges
    graph.edges().forEach(function(e) {
        const edge = graph.edge(e);
        if (edge.label) { svg += `<text class="edgeLabel" x="${edge.x}" y="${edge.y}" fill="${edge.color}">${escapeHTMLEntities(edge.label)}</text>`; }
    });

    // Nodes on top of everything
    graph.nodes().forEach(function(v) {
        const node = graph.node(v);
        // enlarge the nodes to account for rounded rect
        node.width += 8; node.height += 8;
        
        svg += `<rect x="${node.x - node.width / 2}" y="${node.y - node.height / 2}" width="${node.width}" height="${node.height}" rx="16" ry="16" fill="${nodeToHTMLColor(node)}"class="node"/>`;
        if (node.isStart) {
            // Highlight the start node
            svg += `<rect x="${node.x - node.width / 2 + 2}" y="${node.y - node.height / 2 + 2}" width="${node.width - 4}" height="${node.height - 4}" fill="none" rx="14" ry="14" stroke="#302b2b"/>`;
        }
        svg += `<text class="nodeLabel" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}">${node.label}</text>`;
    });

    svg += '</svg>';
    modeEditor.innerHTML = svg;
}


function escapeHTMLEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


function visualizeConstant(value, indent) {
    let s = '';
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; ++i) {
        let k = keys[i];
        let v = Array.isArray(value) ? value[i] : value[k];
        k = escapeHTMLEntities(k);
        if (Array.isArray(v) || typeof v === 'object') {
            s += `<tr valign=top><td>${indent}${k}:</td><td></td><td><i>${Array.isArray(v) ? 'array' : 'object'}</i></td></tr>\n` + visualizeConstant(v, indent + '&nbsp;&nbsp;&nbsp;&nbsp;');
        } else {
            v = escapeHTMLEntities(QRuntime.unparse(v));
            s += `<tr valign=top><td>${indent}${k}:</td><td></td><td><code>${v}</code></td></tr>\n`;
        }
    }
    
    return s;
}


function visualizeGame(gameEditor, url, game) {
    const disabled = editableProject ? '' : 'disabled';
    
    let s = '';

    if (! editableProject) {
        // Why isn't this project editable?
        const reasons = [];

        if (! locallyHosted()) {
            reasons.push('is hosted on a remote server');
        } else if (getQueryString('quadserver') !== '1') {
            reasons.push('is not running locally with the <code>quadplay</code> script');
        }

        if (! useIDE) {
            reasons.push('was launched without the IDE');
        }

        // Is built-in
        if (isBuiltIn(url)) {
            reasons.push('is a built-in example');
        }
        
        s += '<i>This project is locked because it';
        if (reasons.length > 1) {
            // Many reasons
            s += '<ol>\n';
            for (let i = 0; i < reasons.length; ++i) {
                s += '<li>' + reasons[i] + '</li>\n';
            }
            s += '<ol>\n';
        } else {
            // One reason
            s += ' ' + reasons[0] + '.';
        }
        s += '</i><br><br>\n';
    }

    s += '<table>\n';
    s += '<tr valign="top"><td>Path</td><td colspan=3>' + url + '</td></tr>\n';
    s += `<tr valign="top"><td width="110px">Title</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="projectTitle" value="${game.title.replace(/"/g, '\\"')}"></td></tr>\n`;
    s += `<tr valign="top"><td>Developer</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="projectDeveloper" value="${game.developer.replace(/"/g, '\\"')}"></td></tr>\n`;
    s += `<tr valign="top"><td>Copyright</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="projectCopyright" value="${game.copyright.replace(/"/g, '\\"')}"></td></tr>\n`;
    s += `<tr valign="top"><td>License</td><td colspan=3><textarea ${disabled} style="width:384px; padding: 3px; margin-bottom:-3px; font-family: Helvetica, Arial; font-size:12px" rows=2 id="projectLicense" onchange="onProjectMetadataChanged(this)">${game.license}</textarea>`;
    if (editableProject) {
        // License defaults
        s += '<br><button onclick="onProjectLicensePreset(\'All\')">All Rights Reserved</button><button onclick="onProjectLicensePreset(\'GPL\')">GPL 3</button><button onclick="onProjectLicensePreset(\'BSD\')">BSD</button><button onclick="onProjectLicensePreset(\'MIT\')">MIT</button><button onclick="onProjectLicensePreset(\'CC0\')">Public Domain</button>';
    }
    s += '</td></tr>\n';

    if (editableProject) {
        s += '<tr valign="top"><td>Initial&nbsp;Mode</td><td colspan=3><select style="width:390px" onchange="onProjectInitialModeChange(this)">\n';
        for (let i = 0; i < gameSource.modes.length; ++i) {
            const mode = gameSource.modes[i];
            if (! mode.name.startsWith('quad://console/os/_')) {
                s += `<option value=${mode.name} ${mode.name.indexOf('*') !== -1 ? 'selected' : ''}>${mode.name.replace(/\*/g, '')}</option>\n`;
            }
        }
        s += '</select></td></tr>\n';
        
        s += `<tr valign="top"><td>Screen&nbsp;Size</td><td colspan=3><select style="width:390px" onchange="onProjectScreenSizeChange(this)">`;
        const res = [[384, 224], [192,112], [128,128], [64,64]];
        for (let i = 0; i < res.length; ++i) {
            const W = res[i][0], H = res[i][1];
            s += `<option value='{"x":${W},"y":${H}}' ${W === gameSource.json.screen_size.x && H === gameSource.json.screen_size.y ? "selected" : ""}>${W} × ${H}</option>`;
        }
        s += `</select></td></tr>\n`;
    } else {
        // The disabled select box is too hard to read, so revert to a text box when not editable
        for (let i = 0; i < gameSource.modes.length; ++i) {
            const mode = gameSource.modes[i];
            if (! mode.name.startsWith('quad://console/os/_') && (mode.name.indexOf('*') !== -1)) {
                s += `<tr valign="top"><td>Initial&nbsp;Mode</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} value="${mode.name.replace(/\*/g, '')}"></td></tr>\n`;
                break;
            }
        }
        s += `<tr valign="top"><td>Screen&nbsp;Size</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} value="${gameSource.json.screen_size.x} × ${gameSource.json.screen_size.y}"></td></tr>\n`;
    }
    s += `<tr valign="top"><td></td><td colspan=3><label><input type="checkbox" autocomplete="false" style="margin-left:0" ${disabled} ${game.flip_y ? 'checked' : ''} onchange="onProjectFlipYChange(this)">Flip Y Axis</label></td></tr>\n`;

    s+= '<tr><td>&nbsp;</td></tr>\n';
    
    s += `<tr valign="top"><td>Description<br><span id="projectDescriptionLength">(${(game.description || '').length}/100 chars)</span> </td><td colspan=3><textarea ${disabled} style="width:384px; padding: 3px; margin-bottom:-3px; font-family: Helvetica, Arial; font-size:12px" rows=2 id="projectDescription" onchange="onProjectMetadataChanged(this)" oninput="document.getElementById('projectDescriptionLength').innerHTML = '(' + this.value.length + '/100 chars)'">${game.description || ''}</textarea>`;
    s += '<tr valign="top"><td>Features</td><td colspan=3>';
    const boolFields = ['Cooperative', 'Competitive', 'High Scores', 'Achievements'];
    for (let f = 0; f < boolFields.length; ++f) {
        const name = boolFields[f];
        const field = name.replace(/ /g,'').toLowerCase();
        s += `<label><input ${disabled} type="checkbox" id="project${capitalize(field)}" onchange="onProjectMetadataChanged(this)" ${game[field] ? 'checked' : ''}>${name}</label> `;
    }
    s += '</td></tr>\n';
    s += `<tr><td></td><td><input type="number" min="1" max="8" ${disabled} onchange="onProjectMetadataChanged(this)" id="projectMinPlayers" value="${game.min_players || 1}"></input> - <input type="number" min="1" max="8" ${disabled} onchange="onProjectMetadataChanged(this)" id="projectMaxPlayers" value=${game.max_players || 1}></input> Players</td></tr>\n`;

    s+= '<tr><td>&nbsp;</td></tr>\n';
    
    const baseURL = url.replace(/\/[^\/]*$/, '');
    s += '<tr valign="top"><td></td><td style="text-align:center">64px&nbsp;Label<br><img alt="label64.png" src="' + baseURL + '/label64.png" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:64px; height:64px"></td>';
    s += '<td></td><td style="text-align:center">128px&nbsp;Label<br><img alt="label128.png" src="' + baseURL + '/label128.png" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:128px; height:128px"></td></tr>\n';
    s += '</table>';
    gameEditor.innerHTML = s;
}


function visualizeMap(map) {
    const width  = map.length;
    const height = map[0].length;
    const depth  = map.layer.length;

    const maxDim = Math.max(width * map.sprite_size.x, height * map.sprite_size.y);
    
    const reduce = (maxDim > 4096) ? 4 : (maxDim > 2048) ? 3 : (maxDim > 1024) ? 2 : 1;

    const dstTileX = Math.max(1, Math.floor(map.sprite_size.x / reduce));
    const dstTileY = Math.max(1, Math.floor(map.sprite_size.y / reduce));

    const canvas = document.getElementById('mapDisplayCanvas');
    canvas.width = width * dstTileX;
    canvas.height = height * dstTileY;
    const mapCtx = canvas.getContext('2d');

    const dstImageData = mapCtx.createImageData(width * dstTileX, height * dstTileY);
    const dstData = new Uint32Array(dstImageData.data.buffer);
    for (let mapZ = 0; mapZ < depth; ++mapZ) {
        const z = map.zScale < 0 ? depth - mapZ - 1 : mapZ;
        for (let mapY = 0; mapY < height; ++mapY) {
            const y = map._flipYOnLoad ? height - mapY - 1 : mapY;
            for (let mapX = 0; mapX < width; ++mapX) {
                const sprite = map.layer[z][mapX][y];
                if (sprite) {
                    const srcData = sprite.spritesheet._uint32Data;
                    for (let y = 0; y < dstTileY; ++y) {
                        for (let x = 0; x < dstTileX; ++x) {
                            const srcOffset = (sprite._x + x * reduce) + (sprite._y + y * reduce) * srcData.width;
                            const dstOffset = (x + mapX * dstTileX) + (y + mapY * dstTileY) * dstImageData.width;
                            const srcValue = srcData[srcOffset];
                            if ((srcValue >>> 24) > 127) { // Alpha test
                                dstData[dstOffset] = srcValue;
                            }
                        } // x
                    } // y
                } // sprite
            } // x
        } // y
    } // z

    // Draw dotted grid lines
    for (let mapX = 0; mapX < width; ++mapX) {
        const x = mapX * dstTileX;
        for (let y = 0; y < dstImageData.height; ++y) {
            dstData[x + y * dstImageData.width] = (y & 1) ? 0xffcccccc : 0xff777777
        }
    }

    for (let mapY = 0; mapY < height; ++mapY) {
        const y = mapY * dstTileY;
        for (let x = 0; x < dstImageData.width; ++x) {
            dstData[x + y * dstImageData.width] = (x & 1) ? 0xffcccccc : 0xff777777
        }
    }

    mapCtx.putImageData(dstImageData, 0, 0);
}

{
    const text = document.getElementById('newModeName');
    text.onkeydown = function (event) {
        if (event.keyCode === 13) {
            onNewModeCreate();
        } else if (event.keyCode === 27) {
            hideNewModeDialog();
        }
    }
}



/** Creates the left-hand project listing from the gameSource */
function createProjectWindow(gameSource) {
    let s = '';
    {
        const badge = isBuiltIn(gameSource.jsonURL) ? 'builtin' : (isRemote(gameSource.jsonURL) ? 'remote' : '');
        s += `<b title="${gameSource.jsonURL}" onclick="onProjectSelect(event.target, 'game', null)" class="clickable projectTitle ${badge}">${gameSource.json.title}</b>`;
    }
    s += '<div style="border-left: 1px solid #ccc; margin-left: 4px; padding-top: 5px; padding-bottom: 9px; margin-bottom: -7px"><div style="margin:0; margin-left: -2px; padding:0">';

    s += '— <i>Scripts</i>\n';
    s += '<ul class="scripts">';
    for (let i = 0; i < gameSource.scripts.length; ++i) {
        const script = gameSource.scripts[i];
        const badge = isBuiltIn(script) ? 'builtin' : (isRemote(script) ? 'remote' : '');
        s += `<li class="clickable ${badge}" onclick="onProjectSelect(event.target, 'script', gameSource.scripts[${i}])" title="${script}" id="ScriptItem_${script.replace(/\.pyxl$/, '')}">${urlFilename(script)}</li>\n`;
    }
    if (editableProject) {
        s += '<li class="clickable new" onclick="showNewScriptDialog()"><i>New script…</i></li>';
    }
    s += '</ul>';

    
    s += '— <i class="clickable" onclick="onProjectSelect(event.target, \'mode\', undefined)">Modes</i>\n';
    s += '<ul class="modes">';
    for (let i = 0; i < gameSource.modes.length; ++i) {
        const mode = gameSource.modes[i];
        // Hide system modes
        if (/^.*\/_|^_/.test(mode.name)) { continue; }
        const badge = isBuiltIn(mode.url) ? 'builtin' : (isRemote(mode.url) ? 'remote' : '');
        s += `<li class="clickable ${badge}" onclick="onProjectSelect(event.target, 'mode', gameSource.modes[${i}])" title="${mode.url}" id="ModeItem_${mode.name}"><code>${mode.name}</code></li>\n`;
    }
    if (editableProject) {
        s += '<li class="clickable new" onclick="showNewModeDialog()"><i>New mode…</i></li>';
    }
    s += '</ul>';

    s += '— <i>Docs</i>\n';
    s += '<ul class="docs">';
    for (let i = 0; i < gameSource.docs.length; ++i) {
        const doc = gameSource.docs[i];
        const badge = isBuiltIn(doc.url) ? 'builtin' : (isRemote(doc.url) ? 'remote' : '');
        s += `<li class="clickable ${badge}" id="DocItem_${doc.name}" onclick="onProjectSelect(event.target, 'doc', gameSource.docs[${i}])" title="${doc.url}"><code>${doc.name}</code></li>\n`;
    }
    if (editableProject) {
        s += '<li class="clickable new" onclick="showNewDocDialog()"><i>New doc…</i></li>';
    }
    s += '</ul>';
    
    s += '— <i>Constants</i>\n';
    s += '<ul class="constants">';
    {
        const keys = Object.keys(gameSource.json.constants || {});
        keys.sort();
        for (let i = 0; i < keys.length; ++i) {
            const c = keys[i];
            const v = gameSource.constants[c];
            const json = gameSource.json.constants[c];
            const tooltip = (json.description || '').replace(/"/g, '\\"');
            const type = (v === undefined || v === null) ?
                  'nil' :
                  Array.isArray(v) ? 'array' :
                  (json.type && (json.type === 'xy' || json.type === 'xz')) ? 'vec2D' :
                  (json.type && json.type === 'xyz') ? 'vec3D' :
                  (json.type && (json.type === 'rgba' || json.type === 'rgb' || json.type === 'hsva' || json.type === 'hsv')) ? 'color' :
                  (typeof v);
            s += `<li class="clickable ${type}" title="${tooltip}" id="projectConstant_${c}" onclick="onProjectSelect(event.target, 'constant', '${c}')"><code>${c}</code></li>\n`;
        }
    }
    if (editableProject) {
        s += '<li class="clickable new" onclick="showNewConstantDialog()"><i>New constant…</i></li>';
    }
    s += '</ul>';

    s += '</div></div>';
    s += '<div style="margin-left: 3px; position: relative; top: -2px">— <i>Assets</i>\n';
    s += '<ul class="assets">';
    {
        const keys = Object.keys(gameSource.assets);
        for (let i = 0; i < keys.length; ++i) {
            const assetName = keys[i];

            // Hide system assets
            if (assetName[0] === '_') { continue; }

            const asset = gameSource.assets[assetName];
            let type = asset._jsonURL.match(/\.([^.]+)\.json$/i);
            if (type) { type = type[1].toLowerCase(); }

            const badge = isBuiltIn(asset._jsonURL) ? 'builtin' : (isRemote(asset._jsonURL) ? 'remote' : '');
                
            s += `<li onclick="onProjectSelect(event.target, 'asset', gameSource.assets['${assetName}'])" class="clickable ${type} ${badge}" title="${asset._jsonURL}"><code>${assetName}</code></li>`;

            if (type === 'map') {
                for (let k in asset.spritesheet_table) {
                    const badge = isBuiltIn(asset.spritesheet_table[k]._jsonURL) ? 'builtin' : (isRemote(asset.spritesheet_table[k]._jsonURL) ? 'remote' : '');
                    s += `<ul><li onclick="onProjectSelect(event.target, 'asset', gameSource.assets['${assetName}'].spritesheet_table['${k}'])" class="clickable sprite ${badge}" title="${asset.spritesheet_table[k]._jsonURL}"><code>${k}</code></li></ul>\n`;
                }
            }
        } // for each asset
    }
    
    if (editableProject) {
        s += '<li class="clickable new" onclick="showImportAssetDialog()"><i>Import asset…</i></li>';
        // s += '<li class="clickable new" onclick=""><i>New asset…</i></li>';
    }
    s += '</ul>';
    s += '</div>'
    
    // Build the project list for the IDE
    const projectElement = document.getElementById('project');

    // Hide the scrollbars on Windows
    projectElement.innerHTML = '<div class="hideScrollBars">' + s + '</div>';
}


window.gameURL = '';

const autocorrectTable = [
    '\\Delta',    'Δ',
    '\\alpha',    'α',
    '\\beta',     'β',
    '\\gamma',    'γ',
    '\\delta',    'δ',
    '\\epsilon',  'ε',
    '\\zeta',     'ζ',
    '\\eta',      'η',
    '\\theta',    'θ',
    '\\iota',     'ι',
    '\\lambda',   'λ',
    '\\mu',       'μ',
    '\\rho',      'ρ',
    '\\sigma',    'σ',
    '\\phi',      'ϕ',
    '\\chi',      'χ',
    '\\psi',      'ψ',
    '\\omega',    'ω',
    '\\Omega',    'Ω',
    '\\tau',      'τ',
    '\\time',     'τ',
    '\\xi',       'ξ',
    '\\random',      'ξ',
    '\\in',       '∊',
    '==',         '≟',
    '?=',         '≟',
    '!=',         '≠',
    '\\neq',      '≠',
    '\\eq',       '≟',
    '\\not',      '¬',
    '\\leq',      '≤',
    '<=',         '≤',
    '\\geq',      '≥',
    '>=',         '≥',
    '>>',         '▻',
    '<<',         '◅',
    '\\bitand',   '∩',
    '\\bitor',    '∪',
    '\\bitxor',   '⊕',
    '\\pi',       'π',
    '\\infty',    '∞',
    '\\nil',      '∅',
    '\\half',     '½',
    '\\third',    '⅓',
    '\\quarter',  '¼',
    '\\fifth',    '⅕',
    '\\sixth',    '⅙',
    '\\seventh',  '⅐',
    '\\eighth',   '⅛',
    '\\ninth',    '⅑',
    '\\tenth',    '⅒',     
    '\\lfloor',   '⌊',
    '\\rfloor',   '⌋',
    '\\lceil',    '⌈',
    '\\rceil',    '⌉',
    '\\deg',      '°'
];


if (jsCode) {
    jsCode.getSession().setUseWorker(false);
    jsCode.getSession().setMode('ace/mode/javascript');
    jsCode.setReadOnly(true);
    jsCode.getSession().setUseWrapMode(true);
}

let updateImage = document.createElement('canvas');
let updateImageData;
let error = document.getElementById('error');

function setFramebufferSize(w, h) {
    SCREEN_WIDTH = w;
    SCREEN_HEIGHT = h;
    emulatorScreen.width = w;
    emulatorScreen.height = h;

    updateImage.width  = w;
    updateImage.height = h;
    updateImageData = ctx.createImageData(w, h);

    bootScreen.style.fontSize = '' + Math.max(10 * SCREEN_WIDTH / 384, 4) + 'px';
    
    // The layout may need updating as well
    setTimeout(onResize, 0);
    setTimeout(onResize, 250);
    setTimeout(onResize, 1250);
}


// Set by compilation
let programNumLines = 0;
let compiledProgram = '';

// 'stop', 'step', 'pause', 'play'. Slow mode = 'play' with targetFramerate slow
let emulatorMode = 'stop';

const PLAY_FRAMERATE = 60;
const SLOW_FRAMERATE = 8;
let targetFramerate = PLAY_FRAMERATE;

/** Returns non-false if the button whose name starts with ctrl is currently down. */
function pressed(ctrl) {
    return document.getElementById(ctrl + 'Button').checked;
}

/** Sets the visible enabled state of the button whose name starts with ctrl to e */
function setControlEnable(ctrl, e) {
    var b = document.getElementById(ctrl + 'Button');
    if (b) { b.disabled = ! e; }

    var container = document.getElementById(ctrl + 'ButtonContainer');
    if (e) {
        container.classList.remove('disabled');
    } else {
        container.classList.add('disabled');
    }
}

/** Called by the IDE toggle buttons */
function onToggle(button) {
    const win = document.getElementById(button.id.replace('Button', 'Window'));
    if (win) {
        if (button.checked) { win.classList.remove('hidden'); }
        else                { win.classList.add('hidden'); }
    }
}


/** Called by the IDE radio buttons */
function onRadio() {
    // Controls
    if (pressed('play') && ((emulatorMode !== 'play') || (targetFramerate !== PLAY_FRAMERATE))) {
        onPlayButton();
    } else if (pressed('slow') && ((emulatorMode !== 'play') || (targetFramerate !== SLOW_FRAMERATE))) {
        onSlowButton();
    } else if (pressed('pause') && (emulatorMode === 'play')) {
        onPauseButton();
    } else if (pressed('stop') && (emulatorMode !== 'stop')) {
        onStopButton();
    } else if (pressed('step') && (emulatorMode !== 'step')) {
        onStepButton();
    }

    // UI Layout
    if (pressed('emulatorUI') && (uiMode !== 'Emulator')) {
        setUIMode('Emulator', false);
    } else if (pressed('testUI') && (uiMode !== 'Test')) {
        setUIMode('Test', false);
    } else if (pressed('IDEUI') && (uiMode !== 'IDE')) {
        setUIMode('IDE', false);
    } else if (pressed('wideIDEUI') && (uiMode !== 'WideIDE')) {
        setUIMode('WideIDE', false);
    } else if (pressed('maximalUI') && (uiMode !== 'Maximal')) {
        setUIMode('Maximal', false);
    } else if (pressed('editorUI') && (uiMode !== 'Editor')) {
        setUIMode('Editor', false);
    }

    saveIDEState();
}


function setErrorStatus(e) {
    e = escapeHTMLEntities(e);
    error.innerHTML = e;
    if (e !== '') {
        error.style.visibility = 'visible';
        _outputAppend('\n<span style="color:#f55">' + e + '<span>\n');
    } else {
        error.style.visibility = 'hidden';
    }
}


setControlEnable('pause', false);
let coroutine = null;
let emwaFrameTime = 0;
const debugFrameRateDisplay = document.getElementById('debugFrameRateDisplay');
const debugActualFrameRateDisplay = document.getElementById('debugActualFrameRateDisplay');
const debugFramePeriodDisplay = document.getElementById('debugFramePeriodDisplay');
const debugDrawCallsDisplay = document.getElementById('debugDrawCallsDisplay');
const debugModeDisplay = document.getElementById('debugModeDisplay');
const debugPreviousModeDisplay = document.getElementById('debugPreviousModeDisplay');
const debugModeFramesDisplay = document.getElementById('debugModeFramesDisplay');
const debugGameFramesDisplay = document.getElementById('debugGameFramesDisplay');
const outputPane = document.getElementById('outputPane');
const outputDisplayPane = document.getElementById('outputDisplayPane');

// Maps expression strings to values
let debugWatchTable = {};

function debug_watch(expr, value) {
    debugWatchTable[expr] = QRuntime.unparse(value);
}


/** 
    Given a JavaScript runtime error, compute the corresponding nanoscript error by
    parsing the @ pragmas in the compiledProgram code.
 */
function jsToNSError(error) {
    console.log(error);
           
    // Firefox
    let lineNumber = error.lineNumber;

    // Find the first place in the user program that the problem occurred (Firefox and Chrome)
    if (error.stack) {
        const stack = error.stack.split('\n');
        if ((stack.length > 0) && ! /GeneratorFunction|anonymous/.test(stack[0])) {
            if (isSafari) {
                // Safari doesn't give line numbers inside generated
                // code except for the top of the stack. At least find
                // the name of the offending function.
                for (let i = 1; i < stack.length; ++i) {
                    if (stack[i].indexOf('quadplay-runtime.js') === -1) {
                        lineNumber = QRuntime._currentLineNumber + 2;
                        //return {url:'(unknown)', lineNumber:'(unknown)', message: stack[i] + ': ' + error};
                    }
                }
            } else {
            
                for (let i = 1; i < stack.length; ++i) {
                    const match = stack[i].match(/(?:GeneratorFunction|<anonymous>):(\d+):/);
                    if (match) {
                        lineNumber = parseInt(match[1]);
                        break;
                    }
                }
            }
        }
    }
    

    if (! lineNumber && error.lineNumber) {
        // Safari
        lineNumber = error.lineNumber + 1;
    }
    
    if (! lineNumber && error.stack) {
        // Chrome
        const match = error.stack.match(/<anonymous>:(\d+)/);
        if (match) {
            lineNumber = clamp(1, parseInt(match[1]), programNumLines);
        }
    }

    if (error.stack && (error.stack.indexOf('<anonymous>') === -1) && (error.stack.indexOf('GeneratorFunction') === -1) && (error.stack.indexOf('quadplay-runtime.js') !== -1)) {
        return {url:'(unknown)', lineNumber: '(unknown)', message: '' + error};
    }

    if (! lineNumber) {
        return {url: '(unknown)', lineNumber: '(unknown)', message:'' + error};
    }
    
    const lineArray = compiledProgram.split('\n');

    // Look backwards from error.lineNumber for '/*@"'
    let urlLineIndex, urlCharIndex = -1;

    for (urlLineIndex = Math.min(Math.max(0, lineNumber - 1), lineArray.length - 1); (urlLineIndex >= 0) && (urlCharIndex === -1); --urlLineIndex) {
        urlCharIndex = lineArray[urlLineIndex].indexOf('/*@"');
    }

    // Always overshoots by one
    ++urlLineIndex;
    let endCharIndex = lineArray[urlLineIndex].indexOf('*/', urlCharIndex + 1);

    let url = lineArray[urlLineIndex].substring(urlCharIndex + 4, endCharIndex);
    // Strip the line offset
    endCharIndex = url.lastIndexOf(':');
    const quoteIndex = url.lastIndexOf('"');
    let offset = 0;
    if ((endCharIndex !== -1) && (quoteIndex < endCharIndex)) {
        // of the form "url":line
        offset = parseInt(url.substring(endCharIndex + 1));
        url = url.substring(0, endCharIndex);
    }

    return {url: url, lineNumber: lineNumber - urlLineIndex - 3 + offset, message: error.message};
}
    

function updateTimeDisplay(time, name) {
    const td = document.getElementById('debug' + name + 'TimeDisplay');
    const tp = document.getElementById('debug' + name + 'PercentDisplay');

    if (time >= 16.667) {
        // Overtime
        td.style.color = tp.style.color = '#f30';
    } else if (time >= 15.5) {
        // Warning
        td.style.color = tp.style.color = '#fe4';
    } else {
        td.style.color = tp.style.color = 'unset';
    }

    td.innerHTML = '' + time.toFixed(1) + ' ms';
    tp.innerHTML = '(' + Math.round(time * 6) + '%)';
}

// Invoked by requestAnimationFrame() or setTimeout. 
function mainLoopStep() {
    // Keep the callback chain going
    if (emulatorMode === 'play') {
        // We intentionally don't use requestAnimationFrame. It can go
        // above 60 Hz and require explicit throttling on high-refresh
        // displays. And when the game is falling below frame rate, we
        // don't trust requestAnimationFrame to reliably hit our
        // fractions of 60 Hz. Schedule the next step at the *start* of this
        // one, so that the time for processing the step does not create a
        // delay.
        //
        // Do not account for QRuntime._graphicsPeriod here. Always
        // try to run at 60 Hz for input processing and game
        // execution, and drop graphics processing in QRuntime._show()
        // some of the time.
        lastAnimationRequest = setTimeout(mainLoopStep, Math.floor(1000 / targetFramerate - 1));
    }

    // Erase the table every frame
    debugWatchTable = {};

    // Physics time may be spread over multiple QRuntime.physics_simulate() calls,
    // but graphics is always a single QRuntime._show() call. Graphics time may
    // be zero on any individual call.
    QRuntime._physicsTimeTotal = 0;
    QRuntime._graphicsTime = 0;

    // Run the "infinite" loop for a while, maxing out at just under 1/60 of a second or when
    // the program explicitly requests a refresh or keyboard update via _show(). Note that
    // refreshPending may already be false if running with _graphicsPeriod > 1, but it does
    // no harm to set it back to false in that case.
    refreshPending = false;
    updateKeyboardPending = false;

    profiler.startFrame();
    // Run until the end of the game's natural main loop excution, the
    // game invokes QRuntime._show(), or the user ends the
    // program. The game may suppress its own graphics computation
    // inside QRuntime._show() if it is running too slowly.
    try {
        // Worst-case timeout in milliseconds (to yield 10 fps)
        // to keep the browser responsive if the game is in a long
        // top-level loop (which will yield). Some of this is legacy
        // to nanojammer, as quadplay games tend to have code in
        // functions where it can't yield.
        const frameStart = profiler.now();
        const endTime = frameStart + 100;

        while (! updateKeyboardPending && ! refreshPending && (performance.now() < endTime) && (emulatorMode === 'play' || emulatorMode === 'step') && coroutine) {
            // Time interval at which to check for new **gamepad**
            // input; won't be able to process keyboard input since
            // that requires events, which requires going out to the
            // main JavaScript loop.
            const gamepadSampleTime = performance.now() + 1000 / 60;
            updateInput();
            while (! updateKeyboardPending && ! refreshPending && (performance.now() < gamepadSampleTime) && (emulatorMode === 'play' || emulatorMode === 'step') && coroutine) {
                coroutine.next();
            }
        }

        // Reset the touch input state for next frame
        QRuntime.touch.pressed_a = QRuntime.touch.released_a = QRuntime.touch.aa = false;

    } catch (e) {
        if (e.reset_game === 1) {
            // Automatic
            onStopButton(true);
            restartProgram(BOOT_ANIMATION.NONE);
            return;
        } else if (e.quit_game === 1) {
            if (useIDE) {
                onStopButton();
            } else {
                onHomeButton();
            }
        } else if (e.launch_game !== undefined) {
            loadGameIntoIDE(e.launch_game, function () {
                onResize();
                onPlayButton(false, true, e.args);
            });
        } else {
            // Runtime error
            onStopButton();
            e = jsToNSError(e);
            setErrorStatus('file ' + e.url + ' line ' + clamp(1, e.lineNumber, programNumLines) + ': ' + e.message);
        }
    }

    // The frame has ended
    profiler.endFrame(QRuntime._physicsTimeTotal, QRuntime._graphicsTime);

    if ((uiMode === 'Test') || (uiMode === 'IDE') || (uiMode === 'WideIDE')) {
        const frame = profiler.smoothFrameTime.get();
        const logic = profiler.smoothLogicTime.get();
        const physics = profiler.smoothPhysicsTime.get();

        // Show the time that graphics *would* be taking if
        // it wasn't for the frame rate scaler
        const graphics = profiler.smoothGraphicsTime.get() * QRuntime._graphicsPeriod;
        const compute = logic + physics + graphics;
        
        if (profiler.debuggingProfiler) { updateTimeDisplay(frame, 'Interval'); }
        updateTimeDisplay(compute, 'Frame');
        updateTimeDisplay(logic, 'CPU');
        updateTimeDisplay(physics, 'PPU');
        updateTimeDisplay(graphics, 'GPU');

        let color = 'unset';
        if (QRuntime._graphicsPeriod === 2) {
            color = '#fe4';
        } else if (QRuntime._graphicsPeriod > 2) {
            color = '#f30';
        }

        debugFrameRateDisplay.style.color = debugFramePeriodDisplay.style.color = color;
        debugFrameRateDisplay.innerHTML = '' + Math.round(60 / QRuntime._graphicsPeriod) + ' Hz';
        debugFramePeriodDisplay.innerHTML = '(' + ('1½⅓¼⅕⅙'[QRuntime._graphicsPeriod - 1]) + ' ×)';

        if ((QRuntime.mode_frames - 1) % QRuntime._graphicsPeriod === 0) {
            // Only display if the graphics period has just ended, otherwise the display would
            // be zero most of the time
            debugDrawCallsDisplay.innerHTML = '' + QRuntime._previousGraphicsCommandList.length;
        }
    }

    if (debugWatchEnabled && emulatorMode === 'play') {
        const pane = document.getElementById('debugWatchDisplayPane');
        let s = '<table width=100% style="border-collapse: collapse" >'
        for (let expr in debugWatchTable) {
            s += `<tr valign=top><td width=50%>${expr}</td><td>${debugWatchTable[expr]}</td></tr>`;
        }
        pane.innerHTML = s + '</table>';
    }

    if (QRuntime._gameMode) {
        if (QRuntime._modeStack.length) {
            let s = '';
            for (let i = 0; i < QRuntime._modeStack.length; ++i) {
                s += QRuntime._modeStack[i]._name + ' → ';
            }
            debugModeDisplay.innerHTML = s + QRuntime._gameMode._name;
        } else {
            debugModeDisplay.innerHTML = QRuntime._gameMode._name;
        }
    } else {
        debugModeDisplay.innerHTML = '∅';
    }

    if (QRuntime._prevMode) {
        debugPreviousModeDisplay.innerHTML = QRuntime._prevMode._name;
    } else {
        debugPreviousModeDisplay.innerHTML = '∅';
    }
    
    debugModeFramesDisplay.innerHTML = '' + QRuntime.mode_frames;
    debugGameFramesDisplay.innerHTML = '' + QRuntime.game_frames;

    // Update to the profiler's new model of the graphics period
    QRuntime._graphicsPeriod = profiler.graphicsPeriod;

    if (targetFramerate < PLAY_FRAMERATE) {
        // Force the profiler to avoid resetting the
        // graphics rate when in slow mode.
        profiler.reset();
    }
    
    if (emulatorMode === 'step') {
        onPauseButton();
    }
}


/** When true, the system is waiting for a refresh to occur and mainLoopStep should yield
    as soon as possible. */
let refreshPending = false;
let updateKeyboardPending = false;

function reloadRuntime(oncomplete) {
    QRuntime.document.open();
    QRuntime.document.write("<script src='quadplay-runtime-cpu.js' async charset='utf-8'> </script> <script src='quadplay-runtime-gpu.js' async charset='utf-8'> </script>");
    QRuntime.onload = function () {
        QRuntime._SCREEN_WIDTH  = SCREEN_WIDTH;
        QRuntime._SCREEN_HEIGHT = SCREEN_HEIGHT;
        QRuntime.reset_clip();

        // updateImageData.data is a Uint8Clamped RGBA buffer
        QRuntime._screen = new Uint32Array(updateImageData.data.buffer);

        // Remove any base URL that appears to include the quadplay URL
        const _gameURL = gameSource ? (gameSource.jsonURL || '').replace(location.href.replace(/\?.*/, ''), '') : '';
        QRuntime._window = window;
        QRuntime._gameURL = _gameURL;
        QRuntime._debugPrintEnabled = document.getElementById('debugPrintEnabled').checked;
        QRuntime._assertEnabled = document.getElementById('assertEnabled').checked;
        QRuntime._debugWatchEnabled = document.getElementById('debugWatchEnabled').checked;
        QRuntime._showEntityBoundsEnabled = document.getElementById('showEntityBoundsEnabled').checked;
        QRuntime._showPhysicsEnabled = document.getElementById('showPhysicsEnabled').checked;
        QRuntime._debug_watch    = debug_watch;
        QRuntime._fontMap       = fontMap;
        QRuntime._parse         = _parse;
        QRuntime._submitFrame   = submitFrame;
        QRuntime._requestInput  = requestInput;
        QRuntime._updateInput   = updateInput;
        QRuntime._systemPrint   = _systemPrint;
        QRuntime._outputAppend  = _outputAppend;
        QRuntime._parseHexColor = parseHexColor;
        QRuntime._Physics       = Matter;
        QRuntime._spritesheetArray = spritesheetArray;
        QRuntime._fontArray     = fontArray;
        QRuntime.makeEuroSmoothValue = makeEuroSmoothValue;

        // Accessors for touch and gamepads
        const padXGetter = {
            enumerable: true,
            get: function () {
                return this._x * QRuntime._scaleX;
            }
        };

        const dxGetter = {
            enumerable: true,
            get: function () {
                return this._dx * QRuntime._scaleX;
            }
        };
        
        const padXXGetter = {
            enumerable: true,
            get: function () {
                return this._xx * QRuntime._scaleX;
            }
        };
        
        const padYGetter = {
            enumerable: true,
            get: function () {
                return this._y * QRuntime._scaleY;
            }
        };
        
        const dyGetter = {
            enumerable: true,
            get: function () {
                return this._dy * QRuntime._scaleY;
            }
        };
        
        const padYYGetter = {
            enumerable: true,
            get: function () {
                return this._yy * QRuntime._scaleY;
            }
        };
        
        const xyGetter = {
            enumerable: true,
            get: function () {
                return {x: this.x, y: this.y}
            }
        };

        const dxyGetter = {
            enumerable: true,
            get: function () {
                return {x: this.dx, y: this.dy}
            }
        };

        const angleGetter = {
            enumerable: true,
            get: function () {
                let a = (this._angle * QRuntime._scaleY + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
                if (Math.abs(a + Math.PI) < 1e-10) { a = Math.PI; }
                return a;
            }
        };

        const dangleGetter = {
            enumerable: true,
            get: function () {
                let a = (this._dangle * QRuntime._scaleY + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
                if (Math.abs(a + Math.PI) < 1e-10) { a = Math.PI; }
                return a;
            }
        };
        
        QRuntime.touch = {
            _x: 0, _y: 0, _dx: 0, _dy: 0,
            screen_x: 0,
            screen_y: 0,
            screen_dx: 0,
            screen_dy: 0,
            a: false,
            pressed_a: false,
            aa: false,
            released_a: false
        };

        Object.defineProperty(QRuntime.touch, 'xy', xyGetter);
        Object.defineProperty(QRuntime.touch, 'dxy', dxyGetter);
        Object.defineProperty(QRuntime.touch, 'x', {
            enumerable: true,
            get: function () {
                return this.screen_x * QRuntime._scaleX + QRuntime._offsetX;
            }
        });
        Object.defineProperty(QRuntime.touch, 'y', {
            enumerable: true,
            get: function () {
                return this.screen_y * QRuntime._scaleY + QRuntime._offsetY;
            }
        });
        Object.defineProperty(QRuntime.touch, 'dx', {
            enumerable: true,
            get: function () {
                return this.screen_dx * QRuntime._scaleX;
            }
        });
        Object.defineProperty(QRuntime.touch, 'dy', {
            enumerable: true,
            get: function () {
                return this.screen_dy * QRuntime._scaleY;
            }
        });
        Object.defineProperty(QRuntime.touch, 'screen_xy', {
            enumerable: true,
            get: function () {
                return {x: this.screen_x, y: this.screen_y}
            }
        });
        Object.defineProperty(QRuntime.touch, 'screen_dxy', {
            enumerable: true,
            get: function () {
                return {x: this.screen_dx, y: this.screen_dy}
            }
        });
        Object.seal(QRuntime.touch);
        
        QRuntime.gamepad_array = Object.seal([0,0,0,0]);
        for (let p = 0; p < 4; ++p) {
            const type = 'Quadplay';

            // These will be overridden immediately on the first call to updateInput()
            // if the id of the underlying device has changed.
            let controlBindings = JSON.parse(localStorage.getItem('pad0' + p) || 'null');
            if (! controlBindings) {
                controlBindings = {id: isMobile ? 'mobile' : '', type: defaultControlType(p)};
            }
            
            const pad = {
                _x: 0, _dx: 0, _xx: 0,
                _y: 0, _dy: 0, _yy: 0, 
                _angle:0, _dangle:0,
                a:0, b:0, c:0, d:0, _p:0, q:0,
                aa:0, bb:0, cc:0, dd:0, _pp:0, qq:0,
                pressed_a:0, pressed_b:0, pressed_c:0, pressed_d:0, _pressed_p:0, pressed_q:0,
                released_a:0, released_b:0, released_c:0, released_d:0, _released_p:0, released_q:0,
                index: p,
                type: controlBindings.type,
                prompt: controlSchemeTable[controlBindings.type],
                _id: controlBindings.id, 
                _analogX: 0,
                _analogY: 0
            };
            Object.defineProperty(pad, 'x', padXGetter);
            Object.defineProperty(pad, 'dx', dxGetter);
            Object.defineProperty(pad, 'xx', padXXGetter);
            Object.defineProperty(pad, 'y', padYGetter);
            Object.defineProperty(pad, 'dy', dyGetter);
            Object.defineProperty(pad, 'yy', padYYGetter);
            Object.defineProperty(pad, 'xy', xyGetter);
            Object.defineProperty(pad, 'dxy', dxyGetter);
            Object.defineProperty(pad, 'angle', angleGetter);
            Object.defineProperty(pad, 'dangle', dangleGetter);
            QRuntime.gamepad_array[p] = Object.seal(pad);
        }
        QRuntime.joy = QRuntime.gamepad_array[0];
        
        QRuntime.debug_print     = debug_print;
        QRuntime.assert         = assert;
        QRuntime.device_control  = device_control;
        QRuntime.play_audio_clip  = play_audio_clip;
        QRuntime.stop_sound      = stop_sound;
        QRuntime.resume_sound    = resume_sound;
        QRuntime.set_volume = set_volume;
        QRuntime.set_pitch  = set_pitch;
        QRuntime.set_pan    = set_pan;
        QRuntime.debug_pause     = onPauseButton;
        
        if (oncomplete) { oncomplete(); }
    };

    QRuntime.document.close();
}


///////////////////////////////////////////////////////////////////////

function deep_clone(src, alreadySeen) {
    alreadySeen = alreadySeen || new Map();
    if ((src === null) || (src === undefined)) {
        return undefined;
    } else if (alreadySeen.has(src)) {
        return alreadySeen.get(src);
    } else if (Array.isArray(src)) {
        const v = [];
        alreadySeen.set(src, v);
        // We sometimes add extra properties to arrays. Catch these as well
        // as the numeric indices.
        for (let k in src) {
            const i = parseInt(k);
            if (isNaN(i)) {
                // Object key
                v[k] = deep_clone(src[k], alreadySeen);
            } else {
                // Normal array element
                v[i] = deep_clone(src[i], alreadySeen);
            }
        }
        
        return v;
    } else if (typeof src === 'object' && (! src.constructor || (src.constructor === Object.prototype.constructor))) {
        // Some generic object that is safe to clone
        let clone = Object.create(null);
        alreadySeen.set(src, clone);
        for (let key in src) {
            clone[key] = deep_clone(src[key], alreadySeen);
        }
        return clone;
    } else {
        // Some other built-in type
        return src;
    }
}


/** Called by makeConstants as part of loading a game. Maps null to undefined
    for consistency with the rest of pyxlscript. */
function frozenDeepClone(src, alreadySeen) {
    if (src === null || src === undefined) {
        return undefined;
    } else if (alreadySeen.has(src)) {
        return alreadySeen.get(src);
    } else if (Array.isArray(src)) {
        const v = [];
        alreadySeen.set(src, v);
        for (let i = 0; i < src.length; ++i) {
            v[i] = frozenDeepClone(src[i], alreadySeen);
        }
        return Object.freeze(v);
    } else switch (typeof src) {
        case 'string':
        case 'number':
        case 'undefined':
        case 'boolean':
        return src;

        case 'object': {
            let clone = Object.create(null);
            alreadySeen.set(src, clone);
            for (let key in src) {
                if (key[0] === '_') {
                    throw 'Illegal constant field name: "' + key + '"';
                }
                clone[key] = frozenDeepClone(src[key], alreadySeen);
            }
            return Object.freeze(clone);
        }

        default: throw 'Cannot clone an object of type ' + (typeof src);
    } // switch
}

/** Environment is the object to create the constants on (the QRuntime
    iFrame, or the object at that is a package). */
function makeConstants(environment, constants, CREDITS) {
    const alreadySeen = new Map();

    // Create the CONSTANTS object on the environment
    const CONSTANTS = Object.create({});
    defineImmutableProperty(environment, 'CONSTANTS', CONSTANTS);

    // Now redefine all constants appropriately
    redefineConstant(environment, 'SCREEN_SIZE', {x:SCREEN_WIDTH, y:SCREEN_HEIGHT}, alreadySeen);
    redefineConstant(environment, 'CREDITS', CREDITS, alreadySeen);
    
    for (const key in constants) {
        if (key[0] === '_') {
            throw 'Illegal constant field name: "' + key + '"';
        }
        redefineConstant(environment, key, constants[key], alreadySeen);
    }

    // Cannot seal CONSTANTS because that would make the properties non-configurable,
    // which would prevent redefining them during debugging.
    Object.preventExtensions(CONSTANTS);
}


/** Redefines an existing constant on the give environment and its CONSTANTS object. 
    The map is used for cloning and can be undefined */
function redefineConstant(environment, key, value, alreadySeenMap) {
    value = frozenDeepClone(value, alreadySeenMap || new Map());
    defineImmutableProperty(environment, key, value);
    defineImmutableProperty(environment.CONSTANTS, key, value);
}


/** Called by constants and assets to extend the QRuntime environment or redefine
    values within it*/
function defineImmutableProperty(object, key, value) {
    // Set configurable to true so that we can later redefine
    Object.defineProperty(object, key, {configurable: true, writable: false, value: value});
}



/** Bind assets in the environment */
function makeAssets(environment, assets) {
    if ((assets === undefined) || (Object.keys(assets).length === 0)) { return; }

    // Clone the assets, as some of them (like the map) can be mutated
    // at runtime. For speed, do not clone sprites and fonts
    const alreadySeen = new Map();
    const ASSET = {};
    for (const assetName in assets) {
        const assetValue = assets[assetName];
        const assetCopy = ((assetValue._type === 'spritesheet') || (assetValue._type === 'font') || (assetValue._type === 'audioClip')) ?
              assetValue :
              deep_clone(assetValue, alreadySeen);
        ASSET[assetName] = assetCopy;
        defineImmutableProperty(environment, assetName, assetCopy);
    }
    defineImmutableProperty(environment, 'ASSETS', Object.freeze(ASSET));
}


// Pause when losing focus if currently playing...prevents quadplay from
// eating resources in the background during development.
window.addEventListener("blur", function () {
    if (backgroundPauseEnabled && useIDE) {
        onPauseButton();
    }
}, false);

function updateControllerIcons() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads : []);
    let num = 0;
    for (let i = 0; i < gamepads.length; ++i) {
        const pad = gamepads[i];
        if (pad && pad.connected) {
            // Enable this icon
            document.getElementById('controllerIcon' + num).className = 'controllerPresent';
            ++num;
        }
    }

    // Disable the remaining icons
    while (num < 4) {
        document.getElementById('controllerIcon' + num).className = 'controllerAbsent';
        ++num;
    }
}

window.addEventListener("gamepadconnected", function(e) {
    if (onWelcomeScreen) { onWelcomeTouch(); }

    updateControllerIcons();
    console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.", e.gamepad.index, e.gamepad.id, e.gamepad.buttons.length, e.gamepad.axes.length);
});

window.addEventListener("gamepaddisconnected", function(e) {
    updateControllerIcons();
    console.log("Gamepad disconnected from index %d: %s", e.gamepad.index, e.gamepad.id);
});


setTimeout(updateControllerIcons, 100);

const qrcode = new QRCode('serverQRCode',
                          {width:  192,
                           height: 192,
                           colorDark: "rgba(0,0,0,0)",
                           colorLight: "#eee",
                           correctLevel: QRCode.CorrectLevel.H
                          });

function showBootScreen() {
    bootScreen.innerHTML = `<span style="color:#ec5588">quadplay✜ ${version}</span>
<span style="color:#937ab7">© 2020 Morgan McGuire</span>
<span style="color:#5ea9d8">Licensed under LGPL 3.0</span>
<span style="color:#859ca6">https://casual-effects.com</span>

`;
    bootScreen.style.zIndex = 100;
    bootScreen.style.visibility = 'visible';
    
    bootScreen.style.fontSize = '' + Math.max(10 * SCREEN_WIDTH / 384, 4) + 'px';
}


function hideBootScreen() {
    bootScreen.innerHTML = '';
    bootScreen.style.zIndex = -100;
    bootScreen.style.visibility = 'hidden';
}


function appendToBootScreen(msg) {
    bootScreen.innerHTML += msg + '\n';
    bootScreen.scrollTop = bootScreen.scrollHeight;
}


function loadGameIntoIDE(url, callback) {
    if (url !== gameURL) {
        // A new game is being loaded. Throw away the editor sessions.
        removeAllCodeEditorSessions();
    }
    
    if (emulatorMode !== 'stop') { onStopButton(); }

    const isLauncher = /(^quad:\/\/console\/|\/launcher\.game\.json$)/.test(url);
    if (! isLauncher) {
        showBootScreen();
    }
    window.gameURL = url;

    // See if the game is on the same server and not in the
    // games/ or examples/ directory
    editableProject = locallyHosted() && useIDE && (getQueryString('quadserver') === '1') && ! isBuiltIn(url);
    
    // Disable the play, slow, and step buttons
    document.getElementById('slowButton').enabled =
        document.getElementById('stepButton').enabled =
        document.getElementById('playButton').enabled = false;
    
    // Let the boot screen show before appending in the following code
    setTimeout(function() {
        {
            let serverURL = location.origin + location.pathname;
            // Remove common subexpression for shorter URLs
            if (url.substring(0, serverURL.length) === serverURL) {
                url = url.substring(serverURL.length);
            }
            
            // Remove redundant filename for shorterURLs
            url = url.replace(/([^\/:=&]+)\/([^\/:=&]+?)\.game\.json$/, function (match, path, filename) {
                return (path === filename) ? path + '/' : match;
            });
            
            serverURL += '?game=' + url;

            if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(serverURL)) {
                document.getElementById('serverURL').innerHTML =
                    '<p>Your local server is in secure mode and has disabled hosting.</p><p>Exit the quadplay script and run it with <code style="white-space:nowrap">quadplay --host</code> to allow hosting games for mobile devices from this machine.</p>';
                document.getElementById('serverQRCode').style.visibility = 'hidden';
                document.getElementById('serverQRMessage').style.visibility = 'hidden';
            } else {
                qrcode.makeCode(serverURL);
                document.getElementById('serverURL').innerHTML =
                    `<a href="${serverURL}" target="_blank">${serverURL}</a>`;
                document.getElementById('serverQRCode').style.visibility = 'visible';
            }
        }

        onLoadFileStart(url);
        afterLoadGame(url, function () {
            onLoadFileComplete(url);
            hideBootScreen();
            document.title = gameSource.json.title;
            console.log('Loading complete.');
            setFramebufferSize(gameSource.json.screen_size.x, gameSource.json.screen_size.y);
            createProjectWindow(gameSource);
            const resourcePane = document.getElementById('resourcePane');
            resourcePane.innerHTML = `
<br/><center><b style="color:#888">Resource Limits</b></center>
<hr>
<br/>
<table style="margin-left: -2px; width: 100%">
<tr><td width=180>Sprite Pixels</td><td class="right">${Math.round(resourceStats.spritePixels / 1000)}k</td><td>/</td><td class="right" width=40>5505k</td><td class="right" width=45>(${Math.round(resourceStats.spritePixels*100/5505024)}%)</td></tr>
<tr><td>Spritesheets</td><td class="right">${resourceStats.spritesheets}</td><td>/</td><td class="right">128</td><td class="right">(${Math.round(resourceStats.spritesheets*100/128)}%)</td></tr>
<tr><td>Max Spritesheet Width</td><td class="right">${resourceStats.maxSpritesheetWidth}</td><td>/</td><td class="right">1024</td><td class="right">(${Math.round(resourceStats.maxSpritesheetWidth*100/1024)}%)</td></tr>
<tr><td>Max Spritesheet Height</td><td class="right">${resourceStats.maxSpritesheetHeight}</td><td>/</td><td class="right">1024</td><td class="right">(${Math.round(resourceStats.maxSpritesheetHeight*100/1024)}%)</td></tr>
<tr><td>Source Statements</td><td class="right">${resourceStats.sourceStatements}</td><td>/</td><td class="right">8192</td><td class="right">(${Math.round(resourceStats.sourceStatements*100/8192)}%)</td></tr>
<tr><td>Audio Clips</td><td class="right">${resourceStats.sounds}</td><td>/</td><td class="right">128</td><td class="right">(${Math.round(resourceStats.sounds*100/128)}%)</td></tr>
</table>`;
            document.getElementById('restartButtonContainer').enabled =
                document.getElementById('slowButton').enabled =
                document.getElementById('stepButton').enabled =
                document.getElementById('playButton').enabled = true;
            
            const modeEditor = document.getElementById('modeEditor');
            if (modeEditor.style.visibility === 'visible') {
                // Update the editor
                visualizeModes(modeEditor);
            }
            
            updateAllCodeEditorSessions();
            hideWaitDialog();
            
            appendToBootScreen(`

QuadOS ROM:        256269 bytes    
Runtime ROM:       159754 bytes
Framebuffer RAM:   ${384 * 224 * 2} bytes
Sprite RAM:        ${4718592 * 2} bytes
AudioClip units:   128 slots
Code memory:       8192 lines

Boot loader initialized
Checking ROM…OK
Checking kernel…OK
Checking RAM…OK
Checking game pad input…OK

Starting…
`);        
            if (callback) { callback(); }
        }, function (e) {
            updateAllCodeEditorSessions();
            document.getElementById('restartButtonContainer').enabled =
                document.getElementById('slowButton').enabled =
                document.getElementById('stepButton').enabled =
                document.getElementById('playButton').enabled = true;
            hideBootScreen();
            setErrorStatus('Loading ' + url + ' failed: ' + e);
            onStopButton();
            hideWaitDialog();
        });
    }, 15);
}

// Load state
backgroundPauseEnabled = localStorage.getItem('backgroundPauseEnabled');
if (backgroundPauseEnabled === undefined || backgroundPauseEnabled === null) {
    // Default to true
    backgroundPauseEnabled = true;
}

if (! localStorage.getItem('debugPrintEnabled')) {
    // Default to true
    localStorage.setItem('debugPrintEnabled', 'true')
}

if (! localStorage.getItem('assertEnabled')) {
    // Default to true
    localStorage.setItem('assertEnabled', 'true')
}

if (! localStorage.getItem('debugWatchEnabled')) {
    // Default to true
    localStorage.setItem('debugWatchEnabled', 'true')
}

{
    const optionNames = ['showPhysicsEnabled', 'showEntityBoundsEnabled', 'assertEnabled', 'debugPrintEnabled', 'debugWatchEnabled'];
    for (let i = 0; i < optionNames.length; ++i) {
        const name = optionNames[i];
        const value = JSON.parse(localStorage.getItem(name) || 'false');
        const element = document.getElementById(name);
        element.checked = value;
    }
}

{
    let url = getQueryString('game');

    if (url && ! useIDE) {
        // This is a standalone game, so hide the open button
        document.getElementById('openButton').style.visibility = 'hidden';
    }

    url = url || launcherURL;
    // If the url doesn't have a prefix and doesn't begin with a slash,
    // assume that it is relative to the quadplay script in the parent dir.
    if (! (/^(.{3,}:\/\/|[\\/])/).test(url)) {
        url = '../' + url;
    }

    if (useIDE || (url !== 'quad://console/launcher')) {
        loadGameIntoIDE(url, function () {
            onProjectSelect(null, 'game', gameSource.url);
        });
    }
}

document.getElementById('backgroundPauseCheckbox').checked = backgroundPauseEnabled || false;

setUIMode(getQueryString('mode') || localStorage.getItem('uiMode') || 'IDE', false);
setErrorStatus('');
setCodeEditorFontSize(parseInt(localStorage.getItem('codeEditorFontSize') || '14'));
setColorScheme(localStorage.getItem('colorScheme') || 'pink');
onResize();
// Set the initial size
setFramebufferSize(SCREEN_WIDTH, SCREEN_HEIGHT);
reloadRuntime();

