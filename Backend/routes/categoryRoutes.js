const express = require('express');
const {
    createCategory,
    getCategories,
    getCategoryById,
    updateCategory,
    deleteCategory,
} = require('../controllers/categoryController');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const category = require('../validators/category');
const { idParams } = require('../validators/common');

const router = express.Router();

router.use(protect);

router.get('/',  validate({ query: category.list }),    getCategories);
router.post('/', validate({ body:  category.create }),  createCategory);

router.get('/:id',    validate({ params: idParams }),                          getCategoryById);
router.put('/:id',    validate({ params: idParams, body: category.update }),   updateCategory);
router.delete('/:id', validate({ params: idParams, query: category.deleteQuery }), deleteCategory);

module.exports = router;
