import React, { useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import cx from 'classnames';
import { ANNOTATION_COLORS } from '../../defines';
import ViewPopup from './common/view-popup';
import CustomSections from '../common/custom-sections';

import { IconColor16 } from '../common/icons';

import IconHighlight from '../../../../res/icons/16/annotate-highlight.svg';
import IconUnderline from '../../../../res/icons/16/annotate-underline.svg';

function SelectionPopup(props) {
	const { l10n } = useLocalization();
	const [annotationMode, setAnnotationMode] = useState(props.textSelectionAnnotationMode === 'underline' ? 'underline' : 'highlight');
	const [annotationColor, setAnnotationColor] = useState(props.params.annotation.color || ANNOTATION_COLORS[0][1]);
	const savedSelection = useRef(null);

	function handleColorPick(color) {
		setAnnotationColor(color);
	}

	function handleSaveAnnotation(mode = annotationMode) {
		// A style is an action on the selected text. Do not require a second
		// confirmation, or let a double-click create the same annotation twice.
		if (savedSelection.current === props.params.annotation) return;
		savedSelection.current = props.params.annotation;
		try {
			props.onChangeTextSelectionAnnotationMode(mode);
			props.onAddAnnotation({ ...props.params.annotation, type: mode, color: annotationColor });
		}
		catch (error) {
			savedSelection.current = null;
			throw error;
		}
	}

	function handleModePick(mode) {
		setAnnotationMode(mode);
		handleSaveAnnotation(mode);
	}

	function preserveSelection(event) {
		// Keep the PDF selection while mouse/pen focus moves over its popup.
		event.preventDefault();
	}

	function handleAddToNote() {
		props.onAddToNote([props.params.annotation]);
	}

	return (
		<ViewPopup
			className="selection-popup"
			rect={props.params.rect}
			anchorPoint={props.params.anchorPoint}
			uniqueRef={props.params.annotation}
			padding={20}
			preferTop={props.params.preferTop}
			preferLeft={props.params.preferLeft}
		>
			<div className="colors" data-tabstop={1}>
				{ANNOTATION_COLORS.map((color, index) => (<button
					key={index}
					type="button"
					tabIndex={-1}
					className={cx('toolbar-button color-button', { active: annotationColor === color[1] })}
					title={l10n.getString(color[0])}
					aria-label={l10n.getString(color[0])}
					aria-pressed={annotationColor === color[1]}
					data-annotation-color={color[1]}
					onPointerDown={preserveSelection}
					onClick={() => handleColorPick(color[1])}
				><IconColor16 color={color[1]}/></button>))}
			</div>
			<div className="tool-toggle" data-tabstop={1}>
				<button
					type="button"
					tabIndex={-1}
					className={cx('highlight', { active: annotationMode === 'highlight' })}
					title={l10n.getString('reader-highlight-text')}
					aria-pressed={annotationMode === 'highlight'}
					data-annotation-mode="highlight"
					onPointerDown={preserveSelection}
					onClick={() => handleModePick('highlight')}
				><IconHighlight/><span>{l10n.getString('reader-highlight-text')}</span></button>
				<button
					type="button"
					tabIndex={-1}
					className={cx('underline', { active: annotationMode === 'underline' })}
					title={l10n.getString('reader-underline-text')}
					aria-pressed={annotationMode === 'underline'}
					data-annotation-mode="underline"
					onPointerDown={preserveSelection}
					onClick={() => handleModePick('underline')}
				><IconUnderline/><span>{l10n.getString('reader-underline-text')}</span></button>
			</div>
			<button type="button" className="toolbar-button wide-button selection-annotation-save" data-tabstop={1} onPointerDown={preserveSelection} onClick={() => handleSaveAnnotation()}>
				保存批注
			</button>
			{props.enableAddToNote &&
				<button className="toolbar-button wide-button" data-tabstop={1} onClick={handleAddToNote}>
					{l10n.getString('reader-add-to-note')}
				</button>}
			<CustomSections type="TextSelectionPopup" annotation={props.params.annotation}/>
		</ViewPopup>
	);
}

export default SelectionPopup;
