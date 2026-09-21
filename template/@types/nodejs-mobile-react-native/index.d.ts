declare module 'nodejs-mobile-react-native' {
    const start: (scriptPath: string) => void,
        channel: {
            send(msg: unknown): void;
            addListener(event: 'message', listener: (msg: unknown) => void): void;
            removeListener(event: 'message', listener: (msg: unknown) => void): void;
        };
    export { start, channel };
}