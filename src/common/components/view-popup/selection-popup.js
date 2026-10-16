import React, { useState } from 'react';
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

	function handleColorPick(color) {
		setAnnotationColor(color);
	}

	function handleSaveAnnotation() {
		props.onChangeTextSelectionAnnotationMode(annotationMode);
		props.onAddAnnotation({ ...props.params.annotation, type: annotationMode, color: annotationColor });
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
					tabIndex={-1}
					className={cx('toolbar-button color-button', { active: annotationColor === color[1] })}
					title={l10n.getString(color[0])}
					aria-label={l10n.getString(color[0])}
					aria-pressed={annotationColor === color[1]}
					data-annotation-color={color[1]}
					onClick={() => handleColorPick(color[1])}
				><IconColor16 color={color[1]}/></button>))}
			</div>
			<div className="tool-toggle" data-tabstop={1}>
				<button
					tabIndex={-1}
					className={cx('highlight', { active: annotationMode === 'highlight' })}
					title={l10n.getString('reader-highlight-text')}
					aria-pressed={annotationMode === 'highlight'}
					data-annotation-mode="highlight"
					onClick={() => setAnnotationMode('highlight')}
				><IconHighlight/><span>{l10n.getString('reader-highlight-text')}</span></button>
				<button
					tabIndex={-1}
					className={cx('underline', { active: annotationMode === 'underline' })}
					title={l10n.getString('reader-underline-text')}
					aria-pressed={annotationMode === 'underline'}
					data-annotation-mode="underline"
					onClick={() => setAnnotationMode('underline')}
				><IconUnderline/><span>{l10n.getString('reader-underline-text')}</span></button>
			</div>
			<button className="toolbar-button wide-button selection-annotation-save" data-tabstop={1} onClick={handleSaveAnnotation}>
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
