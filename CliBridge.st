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
    instanceVariableNames: 'socket serverProcess port '
    classInstanceVariableNames: 'default '
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
    "Start the CLI bridge server on the given port"
    self default notNil ifTrue: [self default stop].
    self default: (self new startOn: aPort).
    ^self default! !

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
    port := aNumber! !

!CliBridge methodsFor: 'server control'!

startOn: aPort
    "Start the server on the given port"
    self port: aPort.
    socket := SocketAccessor newTCPserverAtPort: port.
    socket soReuseaddr: true.
    socket listenFor: 5.
    Transcript show: 'CliBridge: Listening on localhost:', port printString; cr.
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
    "Handle a client connection"
    | conn stream line response |
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
                    response := self processCommand: line.
                    stream nextPutAll: response.
                    stream cr.
                    stream commit.
                    ^self  "close after one request for now"]].
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
    command = 'NAMESPACES' ifTrue: [^self cmdNamespaces: args].
    command = 'SEARCH' ifTrue: [^self cmdSearch: args].
    command = 'FULLSOURCE' ifTrue: [^self cmdFullSource: args].
    command = 'HIERARCHY' ifTrue: [^self cmdHierarchy: args].
    command = 'PING' ifTrue: [^self okJson: 'pong'].
    command = 'QUIT' ifTrue: [^self okJson: 'bye'].
    command = 'SENDERS' ifTrue: [^self cmdSenders: args].
    command = 'IMPLEMENTORS' ifTrue: [^self cmdImplementors: args].
    command = 'MESSAGES' ifTrue: [^self cmdMessages: args].

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
    | result printed |
    expression isEmpty ifTrue: [^self errorJson: 'Usage: EVAL expression'].
    [
        result := Compiler evaluate: expression.
        printed := [result printString] on: Error do: [:e | '(error in printString)'].
    ] on: Error do: [:e |
        ^self errorJson: 'Evaluation error: ', e messageText].
    ^self okJson: (Dictionary new
        at: 'result' put: printed;
        at: 'class' put: result class name asString;
        yourself)!

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
    ^self okJson: result! !

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

    ^nil! !

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
