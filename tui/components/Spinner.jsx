import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { THEME } from '../constants.js';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const Spinner = () => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80);
    return () => clearInterval(timer);
  }, []);

  return <Text color={THEME.accent}>{frames[frame]}</Text>;
};

export default Spinner;
