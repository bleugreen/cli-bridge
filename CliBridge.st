"CliBridge - A CLI Bridge for VisualWorks Smalltalk
Allows external tools to browse code and evaluate expressions via a simple TCP protocol.

Usage:
  1. File this in: (Filename named: 'CliBridge.st') fileIn
  2. Start manually: CliBridge startOn: 9999
  3. Or start image with: ./vwlinuxx86_64gui image.im -clibridge

Protocol:
  Send: COMMAND [args...]\n
  Receive: JSON response\n
"!

Smalltalk defineClass: #CliBridge
    superclass: #{Core.Object}
    indexedType: #none
    private: false
    instanceVariableNames: 'socket serverProcess port requireAuth '
    classInstanceVariableNames: 'default apiKey previousSources '
    imports: ''
    category: 'CliBridge'!

!CliBridge class methodsFor: 'instance creation'!

default
    ^default!

default: aBridge
    default := aBridge!

new
    ^super new initialize!

start
    "Start the CLI bridge server on the default port (9999)"
    ^self startOn: 9999!

startOn: aPort
    "Start the CLI bridge server on the given port (no auth required)"
    ^self startOn: aPort requireAuth: false!

startWithAuthOn: aPort
    "Start the CLI bridge server with authentication required for ALL connections"
    | key |
    key := self apiKey.  "Triggers generation if needed"
    Transcript show: 'CliBridge API Key: ', key; cr.
    ^self startOn: aPort requireAuth: true!

startOn: aPort requireAuth: authRequired
    "Start the CLI bridge server with explicit auth setting"
    self default notNil ifTrue: [self default stop].
    self default: (self new
        requireAuth: authRequired;
        startOn: aPort).
    ^self default! !

!CliBridge class methodsFor: 'authentication'!

apiKey
    "Return API key - from env var, or from file, or generate new"
    apiKey ifNotNil: [^apiKey].

    "Check env var first (production override)"
    (CEnvironment getenv: 'CLIBRIDGE_API_KEY') ifNotNil: [:k |
        k isEmpty ifFalse: [^apiKey := k]].

    "Check file"
    self apiKeyFile exists ifTrue: [
        ^apiKey := self apiKeyFile contentsOfEntireFile withBlanksTrimmed].

    "Generate and persist"
    ^apiKey := self generateAndSaveKey!

apiKeyFile
    "Return the path to the API key file"
    | dir home |
    home := (CEnvironment getenv: 'HOME') ifNil: ['.'].
    dir := (Filename named: home) / '.clibridge'.
    ^dir / 'api-key'!

generateAndSaveKey
    "Generate a new API key and save it to file"
    | key dir file rand hex stream |
    rand := Random new.
    hex := '0123456789abcdef'.
    stream := WriteStream on: (String new: 32).
    32 timesRepeat: [stream nextPut: (hex at: (rand next * 16) truncated + 1)].
    key := 'vw_', stream contents.
    dir := self apiKeyFile directory.
    dir exists ifFalse: [dir makeDirectory].
    file := self apiKeyFile writeStream.
    [file nextPutAll: key] ensure: [file close].
    Transcript show: '=== CliBridge API Key Generated ==='; cr.
    Transcript show: key; cr.
    Transcript show: 'Saved to: ', self apiKeyFile asString; cr.
    Transcript show: '==================================='; cr.
    ^key!

resetApiKey
    "Clear cached API key (forces reload on next access)"
    apiKey := nil!

previousSources
    "Return dictionary for single-level undo storage"
    ^previousSources ifNil: [previousSources := Dictionary new]! !

!CliBridge class methodsFor: 'startup'!

checkCommandLineAndStart
    "Check for -clibridge command line argument and start if present"
    | args portArg port idx |
    args := CEnvironment commandLine.
    portArg := args detect: [:arg |
        (arg asString asLowercase findString: '-clibridge' startingAt: 1) = 1] ifNone: [^self].
    idx := portArg findString: ':' startingAt: 1.
    port := idx > 0
        ifTrue: [(portArg copyFrom: idx + 1 to: portArg size) asNumber]
        ifFalse: [9999].
    Transcript show: 'CliBridge: Starting on port ', port printString; cr.
    self startOn: port!

initialize
    "Register for startup notification"
    ObjectMemory addDependent: self!

update: aspect with: value from: object
    "Handle image startup"
    aspect == #returnFromSnapshot ifTrue: [
        self checkCommandLineAndStart]! !

!CliBridge methodsFor: 'initialize-release'!

initialize
    port := 9999! !

!CliBridge methodsFor: 'accessing'!

port
    ^port!

port: aNumber
    port := aNumber!

requireAuth
    ^requireAuth ifNil: [false]!

requireAuth: aBoolean
    requireAuth := aBoolean! !

!CliBridge methodsFor: 'server control'!

startOn: aPort
    "Start the server on the given port"
    self port: aPort.
    socket := SocketAccessor newTCPserverAtPort: port.
    socket soReuseaddr: true.
    socket listenFor: 5.
    Transcript show: 'CliBridge: Listening on port ', port printString; cr.
    self requireAuth
        ifTrue: [Transcript show: 'CliBridge: Authentication REQUIRED'; cr]
        ifFalse: [Transcript show: 'CliBridge: Authentication disabled'; cr].
    serverProcess := [
        [socket isActive] whileTrue: [
            | clientSocket |
            clientSocket := socket accept.
            clientSocket notNil ifTrue: [
                [self handleClient: clientSocket] fork]].
    ] forkAt: Processor userBackgroundPriority.
    ^self!

stop
    "Stop the server"
    socket notNil ifTrue: [
        socket close.
        socket := nil].
    serverProcess notNil ifTrue: [
        serverProcess terminate.
        serverProcess := nil].
    Transcript show: 'CliBridge: Stopped'; cr! !

!CliBridge methodsFor: 'client handling'!

handleClient: clientSocket
    "Handle a client connection with optional authentication"
    | conn stream line response authKey command |
    [
        [
            conn := ExternalConnection new
                input: clientSocket;
                output: clientSocket.
            stream := conn readAppendStream.
            stream lineEndTransparent.
            [clientSocket isActive and: [stream atEnd not]] whileTrue: [
                clientSocket readWait.
                line := self readLineFrom: stream.
                (line isNil or: [line isEmpty]) ifFalse: [
                    "Parse AUTH:key prefix if present"
                    (line beginsWith: 'AUTH:') ifTrue: [
                        | spaceIndex |
                        spaceIndex := line indexOf: Character space ifAbsent: [line size + 1].
                        authKey := line copyFrom: 6 to: spaceIndex - 1.
                        command := spaceIndex < line size
                            ifTrue: [line copyFrom: spaceIndex + 1 to: line size]
                            ifFalse: [''].
                    ] ifFalse: [
                        authKey := nil.
                        command := line.
                    ].

                    "Check auth if required"
                    self requireAuth ifTrue: [
                        authKey isNil ifTrue: [
                            response := self errorJsonWithCode: 'AUTH_REQUIRED' message: 'Authentication required'.
                            stream nextPutAll: response; cr; commit.
                            ^self].
                        (self validateApiKey: authKey) ifFalse: [
                            response := self errorJsonWithCode: 'AUTH_FAILED' message: 'Invalid API key'.
                            stream nextPutAll: response; cr; commit.
                            ^self]].

                    "Process the command"
                    response := self processCommand: command.
                    stream nextPutAll: response.
                    stream cr.
                    stream commit.
                    ^self  "close after one request"]].
        ] on: Error do: [:e |
            Transcript show: 'CliBridge client error: ', e messageText; cr].
    ] ensure: [clientSocket close]!

readLineFrom: stream
    "Read a line from stream, handling different line endings"
    | line char |
    line := WriteStream on: (String new: 100).
    [stream atEnd] whileFalse: [
        char := stream next.
        (char = Character cr or: [char = Character lf])
            ifTrue: [^line contents]
            ifFalse: [line nextPut: char]].
    ^line contents!

processCommand: aString
    "Process a command and return JSON response"
    | parts command args |
    parts := aString tokensBasedOn: Character space.
    parts isEmpty ifTrue: [^self errorJson: 'Empty command'].
    command := parts first asUppercase.
    args := parts size > 1
        ifTrue: [parts copyFrom: 2 to: parts size]
        ifFalse: [#()].

    command = 'CLASSES' ifTrue: [^self cmdClasses: args].
    command = 'CLASS' ifTrue: [^self cmdClass: args].
    command = 'METHODS' ifTrue: [^self cmdMethods: args].
    command = 'SOURCE' ifTrue: [^self cmdSource: args].
    command = 'EVAL' ifTrue: [| idx |
        idx := aString findString: ' ' startingAt: 1.
        idx > 0
            ifTrue: [^self cmdEval: (aString copyFrom: idx + 1 to: aString size)]
            ifFalse: [^self errorJson: 'Usage: EVAL expression']].
    command = 'EVAL64' ifTrue: [^self cmdEval64: args].
    command = 'NAMESPACES' ifTrue: [^self cmdNamespaces: args].
    command = 'SEARCH' ifTrue: [^self cmdSearch: args].
    command = 'FULLSOURCE' ifTrue: [^self cmdFullSource: args].
    command = 'HIERARCHY' ifTrue: [^self cmdHierarchy: args].
    command = 'PING' ifTrue: [^self okJson: 'pong'].
    command = 'QUIT' ifTrue: [^self okJson: 'bye'].
    command = 'SENDERS' ifTrue: [^self cmdSenders: args].
    command = 'IMPLEMENTORS' ifTrue: [^self cmdImplementors: args].
    command = 'MESSAGES' ifTrue: [^self cmdMessages: args].
    command = 'EDIT' ifTrue: [^self cmdEdit: args].
    command = 'UNDO' ifTrue: [^self cmdUndo: args].
    command = 'CREATECLASS' ifTrue: [^self cmdCreateClass: args].
    command = 'DELETE' ifTrue: [^self cmdDelete: args].
    command = 'COMMENT' ifTrue: [^self cmdComment: args].
    command = 'GLOBALS' ifTrue: [^self cmdGlobals: args].

    ^self errorJson: 'Unknown command: ', command! !

!CliBridge methodsFor: 'commands'!

cmdClasses: args
    "List all classes, optionally filtered by namespace prefix"
    | classes pattern filtered names |
    pattern := args isEmpty ifTrue: ['*'] ifFalse: [args first asLowercase].
    filtered := pattern = '*'
        ifTrue: [Smalltalk allClasses]
        ifFalse: [Smalltalk allClasses select: [:c |
            (c name asString asLowercase findString: pattern startingAt: 1) > 0]].
    names := filtered collect: [:c | c name asString].
    names := names asSortedCollection asArray.
    ^self okJson: names!

cmdClass: args
    "Get class definition"
    | className class info |
    args isEmpty ifTrue: [^self errorJson: 'Usage: CLASS className'].
    className := args first.
    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    info := Dictionary new.
    info at: 'name' put: class name asString.
    info at: 'superclass' put: (class superclass ifNil: ['nil'] ifNotNil: [:s | s name asString]).
    info at: 'instanceVariables' put: class instVarNames asArray.
    info at: 'classVariables' put: class classVarNames asArray.
    info at: 'category' put: (class category ifNil: [''] ifNotNil: [:c | c asString]).
    info at: 'comment' put: (class comment ifNil: [''] ifNotNil: [:c | c asString]).
    ^self okJson: info!

cmdMethods: args
    "List methods for a class"
    | className class side selectors |
    args isEmpty ifTrue: [^self errorJson: 'Usage: METHODS className [class|instance]'].
    className := args first.
    side := args size > 1 ifTrue: [args at: 2] ifFalse: ['instance'].
    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    side asLowercase = 'class'
        ifTrue: [selectors := class class selectors]
        ifFalse: [selectors := class selectors].
    selectors := selectors asSortedCollection collect: [:s | s asString].
    ^self okJson: selectors asArray!

cmdSource: args
    "Get method source code"
    | className selector class method source |
    args size < 2 ifTrue: [^self errorJson: 'Usage: SOURCE className selector'].
    className := args first.
    selector := args size > 1
        ifTrue: [| s |
            s := WriteStream on: String new.
            2 to: args size do: [:i |
                i > 2 ifTrue: [s nextPut: Character space].
                s nextPutAll: (args at: i)].
            s contents asSymbol]
        ifFalse: [#''].
    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    method := class compiledMethodAt: selector ifAbsent: [
        method := class class compiledMethodAt: selector ifAbsent: [nil]].
    method isNil ifTrue: [^self errorJson: 'Method not found: ', selector asString].

    source := method getSource.
    source isNil ifTrue: [source := '(source not available)'].
    ^self okJson: source asString!

cmdEval: expression
    "Evaluate a Smalltalk expression"
    | result printed wrappedExpr |
    expression isEmpty ifTrue: [^self errorJson: 'Usage: EVAL expression'].
    [
        "Wrap in block to properly return value from expressions with temps"
        wrappedExpr := '[', expression, '] value'.
        result := Compiler evaluate: wrappedExpr.
        printed := [result printString] on: Error do: [:e | '(error in printString)'].
    ] on: Error do: [:e |
        ^self errorJson: 'Evaluation error: ', e messageText].
    ^self okJson: (Dictionary new
        at: 'result' put: printed;
        at: 'class' put: result class name asString;
        yourself)!

cmdEval64: args
    "Evaluate a Base64-encoded Smalltalk expression (supports multi-line)"
    | expression |
    args isEmpty ifTrue: [^self errorJson: 'Usage: EVAL64 base64EncodedExpression'].
    [expression := self decodeBase64: args first]
        on: Error do: [:e | ^self errorJson: 'Base64 decode error: ', e messageText].
    ^self cmdEval: expression!

cmdNamespaces: args
    "List all namespaces"
    | namespaces |
    namespaces := NameSpace allNameSpaces collect: [:ns | ns name asString].
    namespaces := namespaces asSortedCollection asArray.
    ^self okJson: namespaces!

cmdSearch: args
    "Search for classes and methods matching a pattern"
    | pattern results |
    args isEmpty ifTrue: [^self errorJson: 'Usage: SEARCH pattern'].
    pattern := args first.
    results := OrderedCollection new.

    "Search class names"
    pattern := pattern asLowercase.
    Smalltalk allClasses do: [:class |
        (class name asString asLowercase findString: pattern startingAt: 1) > 0 ifTrue: [
            results add: (Dictionary new
                at: 'type' put: 'class';
                at: 'name' put: class name asString;
                yourself)]].

    "Search method names (limit to first 100 matches)"
    Smalltalk allClasses do: [:class |
        results size < 100 ifTrue: [
            class selectors do: [:sel |
                (sel asString asLowercase findString: pattern startingAt: 1) > 0 ifTrue: [
                    results size < 100 ifTrue: [
                        results add: (Dictionary new
                            at: 'type' put: 'method';
                            at: 'class' put: class name asString;
                            at: 'selector' put: sel asString;
                            yourself)]]]]].

    ^self okJson: results asArray!

cmdFullSource: args
    "Get full source for a class - all methods with their source"
    | className class methods stream |
    args isEmpty ifTrue: [^self errorJson: 'Usage: FULLSOURCE className'].
    className := args first.
    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    stream := WriteStream on: (String new: 5000).

    "Class definition"
    stream nextPutAll: '"== ', class name asString, ' =="'; cr; cr.
    stream nextPutAll: 'Superclass: ', (class superclass ifNil: ['nil'] ifNotNil: [:s | s name asString]); cr.
    stream nextPutAll: 'Instance variables: ', class instVarNames printString; cr.
    stream nextPutAll: 'Class variables: ', class classVarNames printString; cr; cr.

    "Instance methods"
    stream nextPutAll: '"== Instance Methods =="'; cr; cr.
    methods := class selectors asSortedCollection.
    methods do: [:sel |
        | method source |
        method := class compiledMethodAt: sel ifAbsent: [nil].
        method notNil ifTrue: [
            source := method getSource.
            source notNil ifTrue: [
                stream nextPutAll: '--- ', class name asString, ' >> ', sel asString, ' ---'; cr.
                stream nextPutAll: source asString; cr; cr]]].

    "Class methods"
    stream nextPutAll: '"== Class Methods =="'; cr; cr.
    methods := class class selectors asSortedCollection.
    methods do: [:sel |
        | method source |
        method := class class compiledMethodAt: sel ifAbsent: [nil].
        method notNil ifTrue: [
            source := method getSource.
            source notNil ifTrue: [
                stream nextPutAll: '--- ', class name asString, ' class >> ', sel asString, ' ---'; cr.
                stream nextPutAll: source asString; cr; cr]]].

    ^self okJson: stream contents!

cmdHierarchy: args
    "Get class hierarchy (superclasses and subclasses)"
    | className class supers subs result |
    args isEmpty ifTrue: [^self errorJson: 'Usage: HIERARCHY className'].
    className := args first.
    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    supers := OrderedCollection new.
    class allSuperclasses do: [:c | supers add: c name asString].

    subs := class subclasses collect: [:c | c name asString].
    subs := subs asSortedCollection asArray.

    result := Dictionary new.
    result at: 'class' put: class name asString.
    result at: 'superclasses' put: supers asArray.
    result at: 'subclasses' put: subs.
    ^self okJson: result!

cmdSenders: args
    "Find all senders of a selector"
    | selector results count |
    args isEmpty ifTrue: [^self errorJson: 'Usage: SENDERS selector'].
    selector := args first asSymbol.
    results := OrderedCollection new.
    count := 0.
    Smalltalk allClasses do: [:class |
        count < 100 ifTrue: [
            class selectors do: [:sel |
                count < 100 ifTrue: [
                    ((class compiledMethodAt: sel ifAbsent: [nil])
                        ifNotNil: [:m | m messages includes: selector]
                        ifNil: [false]) ifTrue: [
                            count := count + 1.
                            results add: (Dictionary new
                                at: 'class' put: class name asString;
                                at: 'selector' put: sel asString;
                                yourself)]]].
            class class selectors do: [:sel |
                count < 100 ifTrue: [
                    ((class class compiledMethodAt: sel ifAbsent: [nil])
                        ifNotNil: [:m | m messages includes: selector]
                        ifNil: [false]) ifTrue: [
                            count := count + 1.
                            results add: (Dictionary new
                                at: 'class' put: class name asString, ' class';
                                at: 'selector' put: sel asString;
                                yourself)]]]]].
    ^self okJson: results asArray!

cmdImplementors: args
    "Find all implementors of a selector"
    | selector results |
    args isEmpty ifTrue: [^self errorJson: 'Usage: IMPLEMENTORS selector'].
    selector := args first asSymbol.
    results := OrderedCollection new.
    Smalltalk allClasses do: [:class |
        (class selectors includes: selector) ifTrue: [
            results add: (Dictionary new
                at: 'class' put: class name asString;
                at: 'side' put: 'instance';
                yourself)].
        (class class selectors includes: selector) ifTrue: [
            results add: (Dictionary new
                at: 'class' put: class name asString;
                at: 'side' put: 'class';
                yourself)]].
    results := results asSortedCollection: [:a :b | (a at: 'class') < (b at: 'class')].
    ^self okJson: results asArray!

cmdMessages: args
    "Get messages sent by a method (useful when source not available)"
    | className selector class method msgs lits result |
    args size < 2 ifTrue: [^self errorJson: 'Usage: MESSAGES className selector'].
    className := args first.
    selector := (args copyFrom: 2 to: args size)
        inject: '' into: [:acc :s | acc, (acc isEmpty ifTrue: [''] ifFalse: [' ']), s].
    selector := selector asSymbol.
    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    method := class compiledMethodAt: selector ifAbsent: [
        class class compiledMethodAt: selector ifAbsent: [nil]].
    method isNil ifTrue: [^self errorJson: 'Method not found: ', selector asString].

    msgs := method messages asArray collect: [:m | m asString].
    msgs := msgs asSortedCollection asArray.
    lits := method literals collect: [:lit |
        lit class name asString, ': ', lit printString].
    lits := lits asArray.

    result := Dictionary new.
    result at: 'class' put: class name asString.
    result at: 'selector' put: selector asString.
    result at: 'messages' put: msgs.
    result at: 'literals' put: lits.
    ^self okJson: result!

cmdEdit: args
    "Edit or create a method. Args: className selector side base64Source
     side is 'instance' or 'class'"
    | className selector side encodedSource source class targetClass oldMethod key |
    args size < 4 ifTrue: [^self errorJson: 'Usage: EDIT className selector side base64Source'].

    className := args first.
    selector := (args at: 2) asSymbol.
    side := args at: 3.
    encodedSource := args at: 4.

    "Decode Base64"
    [source := self decodeBase64: encodedSource]
        on: Error do: [:e | ^self errorJson: 'Base64 decode error: ', e messageText].

    "Find class"
    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    "Instance or class side"
    targetClass := side = 'class'
        ifTrue: [class class]
        ifFalse: [class].

    "Capture existing method for single-level undo"
    key := className, '>>', (args at: 2), '@', side.
    oldMethod := targetClass compiledMethodAt: selector ifAbsent: [nil].
    oldMethod notNil ifTrue: [
        oldMethod getSource notNil ifTrue: [
            self class previousSources at: key put: oldMethod getSource asString]].

    "Compile"
    [targetClass compile: source classified: 'modified by CliBridge']
        on: Error do: [:e | ^self errorJson: 'Compile error: ', e messageText].

    ^self okJson: (Dictionary new
        at: 'class' put: className;
        at: 'selector' put: selector asString;
        at: 'side' put: side;
        at: 'wasNew' put: oldMethod isNil;
        yourself)!

cmdUndo: args
    "Undo last edit to a method. Args: className selector side"
    | className selector side key previousSource class targetClass |
    args size < 3 ifTrue: [^self errorJson: 'Usage: UNDO className selector side'].

    className := args first.
    selector := (args at: 2) asSymbol.
    side := args at: 3.
    key := className, '>>', (args at: 2), '@', side.

    previousSource := self class previousSources at: key ifAbsent: [nil].
    previousSource isNil ifTrue: [^self errorJson: 'No previous version for ', key].

    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    targetClass := side = 'class' ifTrue: [class class] ifFalse: [class].

    [targetClass compile: previousSource classified: 'restored by CliBridge']
        on: Error do: [:e | ^self errorJson: 'Restore error: ', e messageText].

    "Clear the undo after use (single-level)"
    self class previousSources removeKey: key ifAbsent: [].

    ^self okJson: (Dictionary new
        at: 'restored' put: true;
        at: 'class' put: className;
        at: 'selector' put: selector asString;
        at: 'side' put: side;
        yourself)!

cmdCreateClass: args
    "Create a new class. Args: base64JsonPayload
     JSON: {name, superclass, instanceVariables, classVariables, classInstanceVariables, category}"
    | json name superclassName superclass instVars classVars classInstVars category newClass definition |
    args isEmpty ifTrue: [^self errorJson: 'Usage: CREATECLASS base64JsonPayload'].

    "Decode and parse JSON payload"
    [json := self parseJson: (self decodeBase64: args first)]
        on: Error do: [:e | ^self errorJson: 'Invalid payload: ', e messageText].

    name := json at: 'name' ifAbsent: [^self errorJson: 'Missing class name'].
    superclassName := json at: 'superclass' ifAbsent: ['Object'].
    instVars := json at: 'instanceVariables' ifAbsent: [#()].
    classVars := json at: 'classVariables' ifAbsent: [#()].
    classInstVars := json at: 'classInstanceVariables' ifAbsent: [#()].
    category := json at: 'category' ifAbsent: ['CliBridge-Created'].

    "Check if class already exists"
    (self findClass: name) notNil ifTrue: [
        ^self errorJson: 'Class already exists: ', name].

    "Find superclass"
    superclass := self findClass: superclassName.
    superclass isNil ifTrue: [^self errorJson: 'Superclass not found: ', superclassName].

    "Build instance variable string"
    instVars := instVars isString
        ifTrue: [instVars]
        ifFalse: [instVars inject: '' into: [:acc :v | acc, (acc isEmpty ifTrue: [''] ifFalse: [' ']), v asString]].
    classVars := classVars isString
        ifTrue: [classVars]
        ifFalse: [classVars inject: '' into: [:acc :v | acc, (acc isEmpty ifTrue: [''] ifFalse: [' ']), v asString]].
    classInstVars := classInstVars isString
        ifTrue: [classInstVars]
        ifFalse: [classInstVars inject: '' into: [:acc :v | acc, (acc isEmpty ifTrue: [''] ifFalse: [' ']), v asString]].

    "Create the class using subclass protocol"
    [
        newClass := superclass
            subclass: name asSymbol
            instanceVariableNames: instVars
            classVariableNames: classVars
            poolDictionaries: ''
            category: category.
        classInstVars isEmpty ifFalse: [
            newClass class instanceVariableNames: classInstVars].
    ] on: Error do: [:e | ^self errorJson: 'Class creation error: ', e messageText].

    ^self okJson: (Dictionary new
        at: 'created' put: true;
        at: 'name' put: newClass name asString;
        at: 'superclass' put: superclass name asString;
        at: 'category' put: category;
        yourself)!

cmdDelete: args
    "Delete a class or method.
     Usage: DELETE className [selector [side]]
     - DELETE MyClass - deletes the class
     - DELETE MyClass myMethod - deletes instance method
     - DELETE MyClass myMethod class - deletes class method"
    | className selector side class targetClass |
    args isEmpty ifTrue: [^self errorJson: 'Usage: DELETE className [selector [side]]'].

    className := args first.
    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    "If only class name provided, delete the class"
    args size = 1 ifTrue: [
        | name |
        name := class name.
        class subclasses isEmpty ifFalse: [
            ^self errorJson: 'Cannot delete class with subclasses: ', name asString].
        [class removeFromSystem]
            on: Error do: [:e | ^self errorJson: 'Delete error: ', e messageText].
        ^self okJson: (Dictionary new
            at: 'deleted' put: 'class';
            at: 'name' put: name asString;
            yourself)].

    "Otherwise delete a method"
    selector := (args at: 2) asSymbol.
    side := args size > 2 ifTrue: [args at: 3] ifFalse: ['instance'].

    targetClass := side = 'class'
        ifTrue: [class class]
        ifFalse: [class].

    (targetClass includesSelector: selector) ifFalse: [
        ^self errorJson: 'Method not found: ', className, '>>', selector asString].

    [targetClass removeSelector: selector]
        on: Error do: [:e | ^self errorJson: 'Delete error: ', e messageText].

    ^self okJson: (Dictionary new
        at: 'deleted' put: 'method';
        at: 'class' put: className;
        at: 'selector' put: selector asString;
        at: 'side' put: side;
        yourself)!

cmdComment: args
    "Get or set a class comment.
     Usage: COMMENT className [base64EncodedComment]
     - COMMENT MyClass - returns the comment
     - COMMENT MyClass base64Text - sets the comment"
    | className class comment |
    args isEmpty ifTrue: [^self errorJson: 'Usage: COMMENT className [base64Comment]'].

    className := args first.
    class := self findClass: className.
    class isNil ifTrue: [^self errorJson: 'Class not found: ', className].

    "Get comment"
    args size = 1 ifTrue: [
        comment := class comment ifNil: [''].
        ^self okJson: (Dictionary new
            at: 'class' put: className;
            at: 'comment' put: comment asString;
            yourself)].

    "Set comment"
    [comment := self decodeBase64: (args at: 2)]
        on: Error do: [:e | ^self errorJson: 'Base64 decode error: ', e messageText].

    [class comment: comment]
        on: Error do: [:e | ^self errorJson: 'Error setting comment: ', e messageText].

    ^self okJson: (Dictionary new
        at: 'class' put: className;
        at: 'comment' put: comment;
        at: 'updated' put: true;
        yourself)!

cmdGlobals: args
    "List global variables, optionally filtered by pattern with pagination.
     Usage: GLOBALS [pattern] [limit] [offset]"
    | pattern limit offset results allKeys filteredKeys total startIdx endIdx |
    pattern := args isEmpty ifTrue: ['*'] ifFalse: [args first asLowercase].
    limit := args size > 1 ifTrue: [(args at: 2) asNumber] ifFalse: [50].
    offset := args size > 2 ifTrue: [(args at: 3) asNumber] ifFalse: [0].

    allKeys := Smalltalk keys asSortedCollection.
    filteredKeys := pattern = '*'
        ifTrue: [allKeys]
        ifFalse: [allKeys select: [:key |
            (key asString asLowercase findString: pattern startingAt: 1) > 0]].

    total := filteredKeys size.
    startIdx := ((offset + 1) max: 1) min: (total max: 1).
    endIdx := (offset + limit) min: total.

    results := OrderedCollection new.
    startIdx to: endIdx do: [:i |
        | key value entry |
        key := filteredKeys at: i.
        value := Smalltalk at: key ifAbsent: [nil].
        entry := Dictionary new
            at: 'name' put: key asString;
            at: 'class' put: value class name asString;
            yourself.
        "Include value preview for simple objects"
        (value isKindOf: Boolean) ifTrue: [entry at: 'value' put: value].
        (value isKindOf: Number) ifTrue: [entry at: 'value' put: value].
        (value isKindOf: String) ifTrue: [
            entry at: 'value' put: (value size > 100
                ifTrue: [(value copyFrom: 1 to: 100), '...']
                ifFalse: [value])].
        value isNil ifTrue: [entry at: 'value' put: nil].
        results add: entry].

    ^self okJson: (Dictionary new
        at: 'items' put: results asArray;
        at: 'total' put: total;
        at: 'offset' put: offset;
        at: 'limit' put: limit;
        yourself)! !

!CliBridge methodsFor: 'helpers'!

findClass: aString
    "Find a class by name, trying various lookup strategies"
    | class |
    "Try direct lookup"
    class := Smalltalk at: aString asSymbol ifAbsent: [nil].
    (class notNil and: [class isBehavior]) ifTrue: [^class].

    "Try searching all classes"
    Smalltalk allClasses do: [:c |
        c name asString = aString ifTrue: [^c]].

    "Try partial match"
    Smalltalk allClasses do: [:c |
        (c name asString endsWith: aString) ifTrue: [^c]].

    ^nil!

validateApiKey: aKey
    "Validate the provided API key against the configured key"
    | expectedKey |
    expectedKey := self class apiKey.
    expectedKey isNil ifTrue: [^true].  "No key configured = allow all"
    ^expectedKey = aKey!

decodeBase64: aString
    "Decode a Base64-encoded string to bytes, then convert to String"
    | alphabet input output buffer bits count char idx |
    alphabet := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.
    input := aString reject: [:c | c = Character cr or: [c = Character lf or: [c = Character space]]].
    output := WriteStream on: (String new: input size * 3 // 4).
    buffer := 0.
    bits := 0.

    1 to: input size do: [:i |
        char := input at: i.
        char = $= ifFalse: [
            idx := alphabet indexOf: char.
            idx > 0 ifTrue: [
                buffer := (buffer bitShift: 6) bitOr: (idx - 1).
                bits := bits + 6.
                bits >= 8 ifTrue: [
                    bits := bits - 8.
                    output nextPut: (Character value: ((buffer bitShift: bits negated) bitAnd: 16rFF)).
                    buffer := buffer bitAnd: ((1 bitShift: bits) - 1)]]]].

    ^output contents!

parseJson: aString
    "Parse a JSON string into Smalltalk objects (Dictionary, Array, String, Number, Boolean, nil)"
    | stream |
    stream := ReadStream on: aString.
    ^self parseJsonValue: stream!

parseJsonValue: stream
    "Parse a JSON value from stream"
    | char |
    self skipJsonWhitespace: stream.
    stream atEnd ifTrue: [self error: 'Unexpected end of JSON'].
    char := stream peek.
    char = ${ ifTrue: [^self parseJsonObject: stream].
    char = $[ ifTrue: [^self parseJsonArray: stream].
    char = $" ifTrue: [^self parseJsonString: stream].
    char = $t ifTrue: [^self parseJsonTrue: stream].
    char = $f ifTrue: [^self parseJsonFalse: stream].
    char = $n ifTrue: [^self parseJsonNull: stream].
    (char isDigit or: [char = $-]) ifTrue: [^self parseJsonNumber: stream].
    self error: 'Invalid JSON character: ', char asString!

parseJsonObject: stream
    "Parse a JSON object {}"
    | dict key |
    dict := Dictionary new.
    stream next.  "skip {"
    self skipJsonWhitespace: stream.
    stream peek = $} ifTrue: [stream next. ^dict].
    [
        self skipJsonWhitespace: stream.
        key := self parseJsonString: stream.
        self skipJsonWhitespace: stream.
        stream next = $: ifFalse: [self error: 'Expected : in JSON object'].
        dict at: key put: (self parseJsonValue: stream).
        self skipJsonWhitespace: stream.
        stream peek = $}
    ] whileFalse: [
        stream next = $, ifFalse: [self error: 'Expected , or } in JSON object']].
    stream next.  "skip }"
    ^dict!

parseJsonArray: stream
    "Parse a JSON array []"
    | array |
    array := OrderedCollection new.
    stream next.  "skip ["
    self skipJsonWhitespace: stream.
    stream peek = $] ifTrue: [stream next. ^array asArray].
    [
        array add: (self parseJsonValue: stream).
        self skipJsonWhitespace: stream.
        stream peek = $]
    ] whileFalse: [
        stream next = $, ifFalse: [self error: 'Expected , or ] in JSON array']].
    stream next.  "skip ]"
    ^array asArray!

parseJsonString: stream
    "Parse a JSON string"
    | output char |
    stream next = $" ifFalse: [self error: 'Expected " to start string'].
    output := WriteStream on: (String new: 32).
    [stream atEnd] whileFalse: [
        char := stream next.
        char = $" ifTrue: [^output contents].
        char = $\ ifTrue: [
            char := stream next.
            char = $n ifTrue: [output nextPut: Character lf].
            char = $r ifTrue: [output nextPut: Character cr].
            char = $t ifTrue: [output nextPut: Character tab].
            char = $\ ifTrue: [output nextPut: $\].
            char = $" ifTrue: [output nextPut: $"].
            char = $/ ifTrue: [output nextPut: $/].
            "Skip \u for now"
        ] ifFalse: [output nextPut: char]].
    self error: 'Unterminated JSON string'!

parseJsonNumber: stream
    "Parse a JSON number"
    | output char |
    output := WriteStream on: (String new: 16).
    [stream atEnd not and: [(char := stream peek) isDigit or: ['-+.eE' includes: char]]]
        whileTrue: [output nextPut: stream next].
    ^Number readFrom: output contents!

parseJsonTrue: stream
    stream next: 4.  "skip 'true'"
    ^true!

parseJsonFalse: stream
    stream next: 5.  "skip 'false'"
    ^false!

parseJsonNull: stream
    stream next: 4.  "skip 'null'"
    ^nil!

skipJsonWhitespace: stream
    [stream atEnd not and: [stream peek isSeparator]] whileTrue: [stream next]! !

!CliBridge methodsFor: 'json encoding'!

okJson: data
    "Return success JSON"
    ^self toJson: (Dictionary new
        at: 'status' put: 'ok';
        at: 'data' put: data;
        yourself)!

errorJson: message
    "Return error JSON"
    ^self toJson: (Dictionary new
        at: 'status' put: 'error';
        at: 'message' put: message asString;
        yourself)!

errorJsonWithCode: code message: message
    "Return error JSON with error code"
    ^self toJson: (Dictionary new
        at: 'status' put: 'error';
        at: 'code' put: code asString;
        at: 'message' put: message asString;
        yourself)!

toJson: anObject
    "Convert object to JSON string"
    ^self jsonEncode: anObject!

jsonEncode: anObject
    "Simple JSON encoder"
    | stream |
    stream := WriteStream on: (String new: 100).
    self jsonEncode: anObject on: stream.
    ^stream contents!

jsonEncode: anObject on: stream
    "Encode object to JSON on stream"
    anObject isNil ifTrue: [^stream nextPutAll: 'null'].
    anObject == true ifTrue: [^stream nextPutAll: 'true'].
    anObject == false ifTrue: [^stream nextPutAll: 'false'].
    (anObject isKindOf: Number) ifTrue: [^stream print: anObject].
    (anObject isKindOf: String) ifTrue: [^self jsonEncodeString: anObject on: stream].
    (anObject isKindOf: Symbol) ifTrue: [^self jsonEncodeString: anObject asString on: stream].
    (anObject isKindOf: Dictionary) ifTrue: [^self jsonEncodeDictionary: anObject on: stream].
    (anObject isKindOf: Collection) ifTrue: [^self jsonEncodeArray: anObject asArray on: stream].
    "Default: convert to string"
    self jsonEncodeString: anObject printString on: stream!

jsonEncodeString: aString on: stream
    "Encode string with escaping"
    stream nextPut: $".
    aString do: [:char |
        char = $" ifTrue: [stream nextPutAll: '\"'].
        char = $\ ifTrue: [stream nextPutAll: '\\'].
        char = Character cr ifTrue: [stream nextPutAll: '\n'].
        char = Character lf ifTrue: [stream nextPutAll: '\n'].
        char = Character tab ifTrue: [stream nextPutAll: '\t'].
        (char = $" or: [char = $\ or: [char = Character cr or: [char = Character lf or: [char = Character tab]]]])
            ifFalse: [stream nextPut: char]].
    stream nextPut: $"!

jsonEncodeArray: anArray on: stream
    "Encode array as JSON array"
    stream nextPut: $[.
    anArray doWithIndex: [:item :index |
        index > 1 ifTrue: [stream nextPut: $,].
        self jsonEncode: item on: stream].
    stream nextPut: $]!

jsonEncodeDictionary: aDict on: stream
    "Encode dictionary as JSON object"
    | first |
    stream nextPut: ${.
    first := true.
    aDict keysAndValuesDo: [:key :value |
        first ifFalse: [stream nextPut: $,].
        first := false.
        self jsonEncodeString: key asString on: stream.
        stream nextPut: $:.
        self jsonEncode: value on: stream].
    stream nextPut: $}! !

"Initialize the class to register for startup notifications"
CliBridge initialize!
