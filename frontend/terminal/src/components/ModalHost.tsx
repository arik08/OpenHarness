import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';

const WAIT_FRAMES = [
	'Agent is waiting for your input   ',
	'Agent is waiting for your input.  ',
	'Agent is waiting for your input.. ',
	'Agent is waiting for your input...',
];

type QuestionChoice = {
	value: string;
	label: string;
	description?: string;
};

function normalizeQuestionChoices(modal: Record<string, unknown>): QuestionChoice[] {
	const raw = Array.isArray(modal.choices) ? modal.choices : [];
	return raw
		.map((item) => {
			if (!item || typeof item !== 'object') {
				return null;
			}
			const source = item as Record<string, unknown>;
			const value = String(source.value ?? '').trim();
			if (!value) {
				return null;
			}
			return {
				value,
				label: String(source.label ?? value).trim() || value,
				description: String(source.description ?? '').trim() || undefined,
			};
		})
		.filter((item): item is QuestionChoice => item !== null)
		.slice(0, 6);
}

function WaitingAnimation(): React.JSX.Element {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setFrame((f) => (f + 1) % WAIT_FRAMES.length), 500);
		return () => clearInterval(timer);
	}, []);
	return (
		<Text color="magenta" dimColor>
			{WAIT_FRAMES[frame]}
		</Text>
	);
}

function QuestionModal({
	modal,
	modalInput,
	setModalInput,
	onSubmit,
}: {
	modal: Record<string, unknown>;
	modalInput: string;
	setModalInput: (value: string) => void;
	onSubmit: (value: string) => void;
}): React.JSX.Element {
	const [extraLines, setExtraLines] = useState<string[]>([]);

	const handleSubmit = (value: string): void => {
		const allLines = [...extraLines, value];
		setExtraLines([]);
		onSubmit(allLines.join('\n'));
	};

	const toolName = modal.tool_name ? String(modal.tool_name) : null;
	const reason = modal.reason ? String(modal.reason) : null;
	const question = String(modal.question ?? 'Question');
	const choices = normalizeQuestionChoices(modal);

	useInput((chunk, key) => {
		if (key.shift && key.return) {
			setExtraLines((lines) => [...lines, modalInput]);
			setModalInput('');
			return;
		}
		const choiceIndex = Number.parseInt(chunk, 10) - 1;
		const choice = choices[choiceIndex];
		if (choice) {
			setExtraLines([]);
			onSubmit(choice.value);
		}
	});

	return (
		<Box flexDirection="column" marginTop={1} borderStyle="double" borderColor="magenta" paddingX={1}>
			<WaitingAnimation />
			<Box marginTop={1}>
				<Text color="magenta" bold>{'\u2753 '}</Text>
				<Text bold>{question}</Text>
			</Box>
			{toolName ? (
				<Text dimColor>
					{'  '}Tool: <Text color="cyan">{toolName}</Text>
				</Text>
			) : null}
			{reason ? (
				<Text dimColor>{'  '}Reason: {reason}</Text>
			) : null}
			{extraLines.length > 0 && (
				<Box flexDirection="column" marginTop={1} marginLeft={2}>
					{extraLines.map((line, i) => (
						<Text key={i} dimColor>
							{line}
						</Text>
					))}
				</Box>
			)}
			{choices.length > 0 ? (
				<Box flexDirection="column" marginTop={1}>
					{choices.map((choice, index) => (
						<Box key={`${choice.value}-${index}`} flexDirection="column">
							<Text>
								<Text color="cyan">{index + 1}. </Text>
								{choice.label}
							</Text>
							{choice.description ? <Text dimColor>{'   '}{choice.description}</Text> : null}
						</Box>
					))}
				</Box>
			) : null}
			<Box marginTop={1}>
				<Text color="cyan">{'> '}</Text>
				<TextInput value={modalInput} onChange={setModalInput} onSubmit={handleSubmit} />
			</Box>
			<Text dimColor>{'  '}number: choose | shift+enter: newline | enter: submit</Text>
		</Box>
	);
}

function ModalHostInner({
	modal,
	modalInput,
	setModalInput,
	onSubmit,
}: {
	modal: Record<string, unknown> | null;
	modalInput: string;
	setModalInput: (value: string) => void;
	onSubmit: (value: string) => void;
}): React.JSX.Element | null {
	if (modal?.kind === 'permission') {
		return (
			<Box flexDirection="column" marginTop={1}>
				<Text>
					<Text color="yellow" bold>{'\u250C '}</Text>
					<Text bold>Allow </Text>
					<Text color="cyan" bold>{String(modal.tool_name ?? 'tool')}</Text>
					<Text bold>?</Text>
				</Text>
				{modal.reason ? (
					<Text>
						<Text color="yellow">{'\u2502 '}</Text>
						<Text dimColor>{String(modal.reason)}</Text>
					</Text>
				) : null}
				<Text>
					<Text color="yellow">{'\u2514 '}</Text>
					<Text color="green">[y] Allow</Text>
					<Text>{'  '}</Text>
					<Text color="red">[n] Deny</Text>
				</Text>
			</Box>
		);
	}
	if (modal?.kind === 'question') {
		return (
			<QuestionModal
				modal={modal}
				modalInput={modalInput}
				setModalInput={setModalInput}
				onSubmit={onSubmit}
			/>
		);
	}
	if (modal?.kind === 'mcp_auth') {
		return (
			<Box flexDirection="column" marginTop={1}>
				<Text>
					<Text color="yellow" bold>{'\u{1F511} '}</Text>
					<Text bold>MCP Authentication</Text>
				</Text>
				<Text dimColor>{String(modal.prompt ?? 'Provide auth details')}</Text>
				<Box>
					<Text color="cyan">{'> '}</Text>
					<TextInput value={modalInput} onChange={setModalInput} onSubmit={onSubmit} />
				</Box>
			</Box>
		);
	}
	return null;
}

export const ModalHost = React.memo(ModalHostInner);
